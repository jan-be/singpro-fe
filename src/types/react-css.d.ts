// CSS custom properties in a style object (style={{ '--v': '40%' }}): React passes them on as they are
import 'react';

declare module 'react' {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
