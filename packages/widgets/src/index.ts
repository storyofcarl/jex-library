/**
 * @jects/widgets — Jects UI components. Importing this module registers each
 * component with the factory (`create({ type: 'button', ... })`).
 *
 * Side-effect CSS: `import '@jects/widgets/style.css'`.
 */

import './styles.css';

export {
  Button,
  type ButtonConfig,
  type ButtonEvents,
  type ButtonVariant,
  type ButtonSize,
  type IconAlign,
} from './button/button.js';
