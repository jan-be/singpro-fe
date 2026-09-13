"""Rewrite swift-f0's ONNX graph so every node can run on ORT's WebGPU provider.

- Pad + STFT + magnitude + Slice  ->  Conv1d with fixed windowed cos/sin kernels
  (only the 132 bins the model uses), squared, summed, sqrt.
- The int64 chain after ArgMax (Unsqueeze/Sub/Abs/LessOrEqual)  ->  float ops
  (variant a: Cast the ArgMax; variant b: no ArgMax at all, one-hot of the max
  convolved with a 19-wide box = the +-9 bin window).
- Dynamic Shape/Gather/Concat/Expand chains  ->  constants for a fixed 960-sample input.

Validates each variant against the original with onnxruntime (CPU).
"""
import sys, os
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto as TP
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "..", "public", "model.onnx")  # the shipped swift-f0 export
OUT = HERE  # variants land next to this script; copy model-gpu-c.onnx to public/model-gpu.onnx
L, N, HOP, PAD = 960, 1024, 256, 384
BIN_LO, BIN_HI = 3, 135
NB = BIN_HI - BIN_LO            # 132 bins into the CNN
F = (L + 2 * PAD - N) // HOP + 1  # 3 STFT frames
NCLS, WIN = 200, 9

base = onnx.load(SRC)
window = numpy_helper.to_array({t.name: t for t in base.graph.initializer}['onnx::STFT_171']).astype(np.float64)
assert window.shape == (N,)

def dft_kernel():
    n = np.arange(N)
    k = np.arange(BIN_LO, BIN_HI)
    ang = 2 * np.pi * np.outer(k, n) / N
    cos_k = np.cos(ang) * window[None, :]
    sin_k = -np.sin(ang) * window[None, :]
    return np.concatenate([cos_k, sin_k], axis=0)[:, None, :].astype(np.float32)  # [2*NB, 1, N]

def build(variant):
    m = onnx.load(SRC)
    g = m.graph
    nodes = {n.name: n for n in g.node}
    remove = {'/Pad', '/STFT', '/Transpose_1', '/Gather', '/Pow', '/Gather_1', '/Pow_1', '/Add', '/Sqrt', '/Slice_1',
              '/Shape', '/Gather_2', '/Gather_3', '/Unsqueeze_3', '/Unsqueeze_4', '/Concat_1', '/Shape_2', '/Expand'}
    if variant in ('b', 'c'):
        remove |= {'/ArgMax', '/Unsqueeze_1', '/Sub', '/Abs', '/LessOrEqual', '/Cast_1'}
    new_inits = [
        numpy_helper.from_array(dft_kernel(), 'dft_w'),
        numpy_helper.from_array(np.array([1, 1, L], np.int64), 'shape_in'),
        numpy_helper.from_array(np.array([1, 2, NB, F], np.int64), 'shape_reim'),
        numpy_helper.from_array(np.array([1], np.int64), 'axes_1'),
        numpy_helper.from_array(np.array([1, F], np.int64), 'shape_out'),
        numpy_helper.from_array(np.tile(numpy_helper.to_array({t.name: t for t in g.initializer}['pitch_bin_centers'])[None, :], (F, 1)).astype(np.float32), 'pitch_centers_exp'),
    ]
    front = [
        helper.make_node('Reshape', ['input_audio', 'shape_in'], ['dft_in'], name='/gpu/Reshape_in'),
        helper.make_node('Conv', ['dft_in', 'dft_w'], ['dft_out'], name='/gpu/DFT', kernel_shape=[N], strides=[HOP], pads=[PAD, PAD]),
    ]
    if variant == 'c':
        # variant b, but the 1 MB DFT kernel is computed in-graph from constants
        # (ORT folds it at session creation) so the file stays small
        new_inits = [t for t in new_inits if t.name != 'dft_w'] + [
            numpy_helper.from_array(np.array(BIN_LO, np.float32), 'k_start'),
            numpy_helper.from_array(np.array(BIN_HI, np.float32), 'k_end'),
            numpy_helper.from_array(np.array(1.0, np.float32), 'one_f'),
            numpy_helper.from_array(np.array(0.0, np.float32), 'zero_f'),
            numpy_helper.from_array(np.array(float(N), np.float32), 'n_f'),
            numpy_helper.from_array(np.array(2 * np.pi / N, np.float32), 'two_pi_over_n'),
            numpy_helper.from_array(np.array(-1.0, np.float32), 'minus_one'),
            numpy_helper.from_array(np.array([NB, 1], np.int64), 'shape_k'),
            numpy_helper.from_array(np.array([1, N], np.int64), 'shape_n'),
            numpy_helper.from_array(window.astype(np.float32)[None, :], 'window_row'),
            numpy_helper.from_array(np.array([2 * NB, 1, N], np.int64), 'shape_w'),
        ]
        front = [
            helper.make_node('Range', ['k_start', 'k_end', 'one_f'], ['k_range'], name='/gpu/k_range'),
            helper.make_node('Reshape', ['k_range', 'shape_k'], ['k_col'], name='/gpu/k_col'),
            helper.make_node('Range', ['zero_f', 'n_f', 'one_f'], ['n_range'], name='/gpu/n_range'),
            helper.make_node('Reshape', ['n_range', 'shape_n'], ['n_row'], name='/gpu/n_row'),
            helper.make_node('Mul', ['k_col', 'n_row'], ['kn'], name='/gpu/kn'),
            helper.make_node('Mul', ['kn', 'two_pi_over_n'], ['ang'], name='/gpu/ang'),
            helper.make_node('Cos', ['ang'], ['cos_ang'], name='/gpu/cos'),
            helper.make_node('Sin', ['ang'], ['sin_ang'], name='/gpu/sin'),
            helper.make_node('Mul', ['sin_ang', 'minus_one'], ['neg_sin'], name='/gpu/neg_sin'),
            helper.make_node('Concat', ['cos_ang', 'neg_sin'], ['cs'], name='/gpu/cs', axis=0),
            helper.make_node('Mul', ['cs', 'window_row'], ['cs_win'], name='/gpu/cs_win'),
            helper.make_node('Reshape', ['cs_win', 'shape_w'], ['dft_w'], name='/gpu/dft_w'),
        ] + front
    front += [
        helper.make_node('Reshape', ['dft_out', 'shape_reim'], ['dft_reim'], name='/gpu/Reshape_reim'),
        helper.make_node('Mul', ['dft_reim', 'dft_reim'], ['dft_sq'], name='/gpu/Square'),
        helper.make_node('ReduceSum', ['dft_sq', 'axes_1'], ['dft_pow'], name='/gpu/Power', keepdims=0),
        helper.make_node('Sqrt', ['dft_pow'], ['/Slice_1_output_0'], name='/gpu/Magnitude'),
    ]
    tail = []
    if variant == 'a':
        new_inits += [
            numpy_helper.from_array(np.arange(NCLS, dtype=np.float32), 'range_f'),
            numpy_helper.from_array(np.array(float(WIN), np.float32), 'win_f'),
        ]
        tail = [helper.make_node('Cast', ['/ArgMax_output_0'], ['argmax_f'], name='/gpu/CastArgMax', to=TP.FLOAT)]
        nodes['/Unsqueeze_1'].input[0] = 'argmax_f'
        nodes['/Sub'].input[0] = 'range_f'
        nodes['/LessOrEqual'].input[1] = 'win_f'
    else:
        new_inits += [
            numpy_helper.from_array(np.array([-1], np.int64), 'axes_last'),
            numpy_helper.from_array(np.array([F, 1, NCLS], np.int64), 'shape_oh3'),
            numpy_helper.from_array(np.array([F, NCLS], np.int64), 'shape_oh2'),
            numpy_helper.from_array(np.ones((1, 1, 2 * WIN + 1), np.float32), 'box_w'),
        ]
        tail = [
            helper.make_node('ReduceMax', ['/Reshape_2_output_0', 'axes_last'], ['prob_max'], name='/gpu/Max', keepdims=1),
            helper.make_node('Equal', ['/Reshape_2_output_0', 'prob_max'], ['onehot_b'], name='/gpu/IsMax'),
            helper.make_node('Cast', ['onehot_b'], ['onehot'], name='/gpu/OneHot', to=TP.FLOAT),
            helper.make_node('Reshape', ['onehot', 'shape_oh3'], ['onehot3'], name='/gpu/Reshape_oh3'),
            helper.make_node('Conv', ['onehot3', 'box_w'], ['mask3'], name='/gpu/Window', kernel_shape=[2 * WIN + 1], pads=[WIN, WIN]),
            helper.make_node('Reshape', ['mask3', 'shape_oh2'], ['/Cast_1_output_0'], name='/gpu/Reshape_mask'),
        ]
    nodes['/Reshape_3'].input[1] = 'shape_out'
    nodes['/Reshape_4'].input[1] = 'shape_out'
    nodes['/Mul_1'].input[1] = 'pitch_centers_exp'

    kept = [n for n in g.node if n.name not in remove]
    # insert the new front before the first kept node, the tail right before /Mul (which consumes the mask)
    out_nodes = list(front)
    for n in kept:
        if variant in ('b', 'c') and n.name == '/Mul':
            out_nodes += tail
        out_nodes.append(n)
        if variant == 'a' and n.name == '/ArgMax':
            out_nodes += tail
    del g.node[:]
    g.node.extend(out_nodes)

    used = {i for n in g.node for i in n.input}
    keep_inits = [t for t in g.initializer if t.name in used] + [t for t in new_inits if t.name in used]
    del g.initializer[:]
    g.initializer.extend(keep_inits)

    g.input[0].type.tensor_type.shape.dim[1].dim_value = L
    for o in g.output:
        d = o.type.tensor_type.shape.dim
        d[0].dim_value = 1; d[1].dim_value = F
    del g.value_info[:]  # stale types from the original graph (int64 chain)
    m = onnx.shape_inference.infer_shapes(m)
    onnx.checker.check_model(m)
    path = os.path.join(OUT, f'model-gpu-{variant}.onnx')
    onnx.save(m, path)
    return path, len(g.node), os.path.getsize(path)

def test_inputs():
    rng = np.random.default_rng(7)
    xs = []
    t = np.arange(L) / 16000
    for i in range(120):
        f = 80 * 2 ** (rng.uniform(0, 4.5))
        amp = rng.uniform(0.02, 0.6)
        x = amp * (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * 2 * f * t + 0.3) + 0.2 * np.sin(2 * np.pi * 3 * f * t))
        x += rng.normal(0, rng.uniform(0.001, 0.05), L)
        xs.append(x.astype(np.float32))
    for i in range(30):
        xs.append(rng.normal(0, rng.uniform(0.001, 0.3), L).astype(np.float32))
    return xs

orig = ort.InferenceSession(SRC, providers=['CPUExecutionProvider'])
xs = test_inputs()
ref = [orig.run(None, {'input_audio': x[None, :]}) for x in xs]
for v in ('a', 'b', 'c'):
    path, nnodes, size = build(v)
    s = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    dp = dc = 0.0; nconf = 0
    for x, (rp, rc) in zip(xs, ref):
        p, c = s.run(None, {'input_audio': x[None, :]})
        dp = max(dp, float(np.abs(p - rp).max())); dc = max(dc, float(np.abs(c - rc).max()))
        nconf += int(((rc >= 0.85) != (c >= 0.85)).sum())
    print(f"variant {v}: {nnodes} nodes, {size/1024:.0f} KB, max |dpitch| {dp:.4f} Hz, max |dconf| {dc:.6f}, threshold flips {nconf}/{len(xs)*F}")
