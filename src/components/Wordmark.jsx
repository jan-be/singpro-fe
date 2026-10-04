import raw from "../wordmark.svg?raw";
import { createInlineSvg } from "./inlineSvg";

/**
 * The SingPro wordmark (src/wordmark.svg): the icon's neon S with its mic,
 * then "ing" in the same pink and "Pro" in the mic's cyan, in the neon tube
 * letters. The drawing leaves room above for the mic and below for the g,
 * so it is taller than its letters: about 2.2 × the capital height.
 */
const Wordmark = createInlineSvg(raw, { label: "SingPro" });
export default Wordmark;
