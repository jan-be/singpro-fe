"""Build the pitch worker's minimal ONNX Runtime for WebAssembly (see README.md).

    python tools/ort-minimal/build.py --work D:/ort-build

Clones ONNX Runtime at the pinned tag into --work (it needs ~3 GB there: the
sources, Emscripten, the build tree), converts public/model.onnx to the ORT
format, builds a single-threaded SIMD runtime with only the model's
operators and types, and copies the results into the app:
src/vendor/ort-minimal/ort-wasm-simd.{mjs,wasm} and public/model.ort.
Re-running reuses the clone, Emscripten and the build tree.
"""

import argparse
import gzip
import hashlib
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ORT_VERSION = '1.29.0'
ORT_COMMIT = '2e2543fbe9fae542f921d47a72d21d5a4ef0b710'  # tag v1.29.0
ORT_REPO = 'https://github.com/microsoft/onnxruntime.git'
EMSDK_VERSION = '4.0.23'  # the Emscripten ONNX Runtime 1.29.0 pins (build.py --emsdk_version)

HERE = Path(__file__).resolve().parent
FE = HERE.parent.parent
MODEL = FE / 'public' / 'model.onnx'
OUT_RUNTIME = FE / 'src' / 'vendor' / 'ort-minimal'
OUT_MODEL = FE / 'public' / 'model.ort'
OUT_OPS = HERE / 'required_operators_and_types.config'
ARTIFACTS = ['ort-wasm-simd.mjs', 'ort-wasm-simd.wasm']
# Our changes to ONNX Runtime's sources (README.md, "Patches")
PATCHES = [HERE / 'mlas-im2col.patch', HERE / 'mlas-narrow-conv.patch', HERE / 'stft-multiply.patch']


def run(cmd, **kw):
    cmd = [str(c) for c in cmd]
    print('+', ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True, **kw)


def checkout(src):
    if not src.exists():
        # autocrlf off: the sources exactly as upstream has them, on any OS
        run(['git', '-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', 'clone', '--depth', '1',
             '--branch', f'v{ORT_VERSION}', ORT_REPO, src])
    head = subprocess.check_output(['git', '-C', src, 'rev-parse', 'HEAD'], text=True).strip()
    if head != ORT_COMMIT:
        sys.exit(f'{src} is at {head}, not v{ORT_VERSION} ({ORT_COMMIT})')
    # The only submodule the WebAssembly build needs; everything else CMake downloads (cmake/deps.txt)
    run(['git', '-C', src, '-c', 'core.autocrlf=false', 'submodule', 'update', '--init', '--depth', '1', 'cmake/external/emsdk'])


def patch_pre_js(src):
    """Drop ORT's SharedArrayBuffer stand-in from the module's JS.

    For its threaded build ORT defines SharedArrayBuffer, where a page lacks
    it, as the buffer type of a new shared WebAssembly.Memory. A single-
    threaded build never refers to SharedArrayBuffer, so all that line does
    is create shared memory, the very thing this runtime exists to avoid
    (old Safari keeps shared memory it should release).
    """
    pre = src / 'onnxruntime' / 'wasm' / 'pre.js'
    text = pre.read_text(encoding='utf-8')
    patched = re.sub(r'var SharedArrayBuffer =.*?\.buffer\.constructor;', '', text, flags=re.S)
    if patched != text:
        pre.write_text(patched, encoding='utf-8', newline='')


def apply_patches(src):
    """Apply PATCHES to the clone, each once (a re-run finds them applied).

    The files they touch first get LF line endings, as in the patches: a
    checkout on Windows may have CRLF.
    """
    for patch in PATCHES:
        for path in re.findall(r'(?m)^\+\+\+ b/(\S+)$', patch.read_text(encoding='utf-8')):
            target = src / path
            target.write_text(target.read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
        applied = subprocess.run(['git', '-C', src, 'apply', '--reverse', '--check', patch], capture_output=True).returncode == 0
        if not applied:
            run(['git', '-C', src, 'apply', patch])


def emsdk_node(src):
    """Install Emscripten and return its Node.js bin dir.

    ORT's build.py installs the same Emscripten itself, but only right before
    CMake's configure step, which already needs Node.js on PATH.
    """
    emsdk_dir = src / 'cmake' / 'external' / 'emsdk'
    emsdk = emsdk_dir / ('emsdk.bat' if os.name == 'nt' else 'emsdk')
    run([emsdk, 'install', EMSDK_VERSION], cwd=emsdk_dir)
    run([emsdk, 'activate', EMSDK_VERSION], cwd=emsdk_dir)
    bins = sorted((emsdk_dir / 'node').glob('*/bin'))
    if not bins:
        sys.exit(f'no Node.js in {emsdk_dir / "node"}')
    return bins[-1]


def convert_model(work):
    """public/model.onnx → model.ort plus the list of its operators and types.

    'Fixed' bakes in the optimizations the stock runtime applies when it
    loads model.onnx (level 'all', which on WebAssembly is 'extended': the
    converter leaves out the x86-only NCHWc layout unless told otherwise), so
    the minimal runtime, which runs a graph as saved, computes the same graph.
    """
    model_dir = work / 'model'
    shutil.rmtree(model_dir, ignore_errors=True)
    model_dir.mkdir(parents=True)
    shutil.copy(MODEL, model_dir / 'model.onnx')
    run([sys.executable, '-m', 'onnxruntime.tools.convert_onnx_models_to_ort', model_dir / 'model.onnx',
         '--output_dir', model_dir / 'out', '--optimization_style', 'Fixed', '--enable_type_reduction'])
    return model_dir / 'out' / 'model.ort', model_dir / 'out' / 'model.required_operators_and_types.config'


def build(src, build_dir, ops_config, config, jobs, node_bin):
    tools = Path(sys.executable).parent  # cmake and ninja from requirements.txt
    env = dict(os.environ, PATH=os.pathsep.join([str(tools), str(node_bin), os.environ.get('PATH', '')]))
    # ORT's error messages carry __FILE__; map the paths so the binary does not
    # depend on where it was built
    prefix_map = f'-ffile-prefix-map={src.as_posix()}/=ort/ -ffile-prefix-map={build_dir.as_posix()}/=build/'
    run([sys.executable, src / 'tools' / 'ci_build' / 'build.py',
         '--build_dir', build_dir, '--config', config, '--parallel', str(jobs),
         '--update', '--build', '--skip_tests', '--skip_submodule_sync', '--cmake_generator', 'Ninja',
         '--emsdk_version', EMSDK_VERSION,
         '--build_wasm', '--enable_wasm_simd',  # no --enable_wasm_threads: ordinary memory, no SharedArrayBuffer
         '--minimal_build',  # ORT-format models only: no ONNX parser, schemas or graph optimizers
         '--include_ops_by_config', ops_config, '--enable_reduced_operator_type_support',
         '--disable_exceptions', '--disable_rtti',
         '--disable_ml_ops', '--disable_generation_ops',
         '--disable_types', 'string', 'float4', 'float8', 'optional', 'sparsetensor',
         '--emscripten_settings', 'ENVIRONMENT=web,worker',  # no Node.js code in the JS
         # an unused source file's vectorization pragma fails at -Os, and warnings are errors by default
         '--compile_no_warning_as_error',
         '--cmake_extra_defines', f'CMAKE_C_FLAGS={prefix_map}', f'CMAKE_CXX_FLAGS={prefix_map}'],
        env=env)
    return build_dir / config


def sizes(path):
    data = path.read_bytes()
    line = f'{path.name:24} {len(data):>10,} B   gzip {len(gzip.compress(data, 9)):>9,} B'
    try:
        import brotli
        line += f'   brotli {len(brotli.compress(data, quality=11)):>9,} B'
    except ImportError:
        pass
    return line + f'   sha256 {hashlib.sha256(data).hexdigest()[:16]}'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--work', default=os.environ.get('ORT_MINIMAL_WORK'),
                    help='directory for the ONNX Runtime clone, Emscripten and the build (~3 GB)')
    ap.add_argument('--config', default='MinSizeRel', choices=['MinSizeRel', 'Release'])
    ap.add_argument('--jobs', type=int, default=os.cpu_count())
    args = ap.parse_args()
    if not args.work:
        ap.error('--work (or ORT_MINIMAL_WORK) is required')

    import onnxruntime  # the converter writes the ORT format of its own version
    if onnxruntime.__version__ != ORT_VERSION:
        sys.exit(f'needs onnxruntime=={ORT_VERSION} for the model conversion, found {onnxruntime.__version__} '
                 f'(pip install -r {HERE / "requirements.txt"})')

    work = Path(args.work).resolve()
    src = work / 'onnxruntime'
    work.mkdir(parents=True, exist_ok=True)
    checkout(src)
    patch_pre_js(src)
    apply_patches(src)
    node_bin = emsdk_node(src)
    model_ort, ops_config = convert_model(work)
    out = build(src, work / 'build', ops_config, args.config, args.jobs, node_bin)

    glue = (out / ARTIFACTS[0]).read_text(encoding='utf-8')
    if 'SharedArrayBuffer' in glue or 'WebAssembly.Memory' in glue:
        sys.exit('the runtime JS still creates shared memory; see patch_pre_js')
    OUT_RUNTIME.mkdir(parents=True, exist_ok=True)
    for name in ARTIFACTS:
        shutil.copy(out / name, OUT_RUNTIME / name)
    shutil.copy(model_ort, OUT_MODEL)
    ops = ops_config.read_text(encoding='utf-8')  # its header names the converted file by its path here
    OUT_OPS.write_text(re.sub(r'(?m)^# - .*$', '# - public/model.onnx, converted by tools/ort-minimal/build.py', ops),
                       encoding='utf-8', newline='\n')
    print()
    for p in [OUT_RUNTIME / name for name in ARTIFACTS] + [OUT_MODEL]:
        print(sizes(p))


if __name__ == '__main__':
    main()
