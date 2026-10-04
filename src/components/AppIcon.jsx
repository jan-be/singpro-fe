import raw from "../icon.svg?raw";
import { createInlineSvg } from "./inlineSvg";

/**
 * The app icon (src/icon.svg, the same drawing as public/icon.svg) drawn
 * inline: on the share card, and as the logo where the wordmark does not fit.
 */
const AppIcon = createInlineSvg(raw);
export default AppIcon;
