/**
 * @jects/widgets — Jects UI components. Importing this module registers each
 * component with the factory (`create({ type: 'button', ... })`).
 *
 * Side-effect CSS: `import '@jects/widgets/style.css'`.
 */

import './styles.css';

/* ── button ──────────────────────────────────────────────────────────── */
export {
  Button,
  type ButtonConfig,
  type ButtonEvents,
  type ButtonVariant,
  type ButtonSize,
  type IconAlign,
} from './button/button.js';

/* ── fields ──────────────────────────────────────────────────────────── */
export {
  TextField,
  type TextFieldConfig,
  type TextFieldEvents,
  type FieldSize,
} from './fields/text-field.js';

export {
  NumberField,
  type NumberFieldConfig,
  type NumberFieldEvents,
} from './fields/number-field.js';

export {
  TextArea,
  type TextAreaConfig,
  type TextAreaEvents,
} from './fields/text-area.js';

export {
  DisplayField,
  type DisplayFieldConfig,
  type DisplayFieldEvents,
} from './fields/display-field.js';

export { Label, type LabelConfig, type LabelEvents } from './fields/label.js';

export {
  Link,
  type LinkConfig,
  type LinkEvents,
  type LinkVariant,
} from './fields/link.js';

/* ── choice ──────────────────────────────────────────────────────────── */
export {
  Select,
  type SelectConfig,
  type SelectEvents,
  type SelectOption,
} from './choice/select.js';

export {
  ComboBox,
  type ComboBoxConfig,
  type ComboBoxEvents,
  type ComboBoxOption,
} from './choice/combobox.js';

export {
  Checkbox,
  type CheckboxConfig,
  type CheckboxEvents,
} from './choice/checkbox.js';

export {
  CheckboxGroup,
  type CheckboxGroupConfig,
  type CheckboxGroupEvents,
  type CheckboxOption,
} from './choice/checkbox-group.js';

export { Radio, type RadioConfig, type RadioEvents } from './choice/radio.js';

export {
  RadioGroup,
  type RadioGroupConfig,
  type RadioGroupEvents,
  type RadioOption,
} from './choice/radio-group.js';

export {
  Switch,
  type SwitchConfig,
  type SwitchEvents,
} from './choice/switch.js';

/* ── display ─────────────────────────────────────────────────────────── */
export {
  Slider,
  type SliderConfig,
  type SliderEvents,
} from './display/slider.js';

export {
  RangeSlider,
  type RangeSliderConfig,
  type RangeSliderEvents,
} from './display/range-slider.js';

export {
  Rating,
  type RatingConfig,
  type RatingEvents,
} from './display/rating.js';

export {
  ProgressBar,
  type ProgressBarConfig,
  type ProgressBarEvents,
  type ProgressVariant,
  type ProgressSize,
} from './display/progress-bar.js';

export {
  Badge,
  type BadgeConfig,
  type BadgeEvents,
  type BadgeVariant,
} from './display/badge.js';

export {
  Avatar,
  type AvatarConfig,
  type AvatarEvents,
  type AvatarSize,
  type AvatarShape,
} from './display/avatar.js';

export {
  Spacer,
  type SpacerConfig,
  type SpacerEvents,
  type SpacerAxis,
  type SpacerSize,
} from './display/spacer.js';

/* ── datetime ────────────────────────────────────────────────────────── */
export {
  DatePicker,
  type DatePickerConfig,
  type DatePickerEvents,
} from './datetime/date-picker.js';

export {
  TimePicker,
  type TimePickerConfig,
  type TimePickerEvents,
} from './datetime/time-picker.js';

export {
  DateTimeField,
  type DateTimeFieldConfig,
  type DateTimeFieldEvents,
} from './datetime/date-time-field.js';

export {
  MiniCalendar,
  type MiniCalendarConfig,
  type MiniCalendarEvents,
} from './datetime/mini-calendar.js';

export {
  type WeekStart,
  type TimeValue,
  MONTH_NAMES,
  WEEKDAY_NAMES,
  WEEKDAY_ABBR,
  startOfDay,
  isSameDay,
  isSameMonth,
  addDays,
  addMonths,
  daysInMonth,
  clampDate,
  isDisabledDay,
  buildMonthMatrix,
  weekdayHeaders,
  parseISODate,
  formatISODate,
  pad2,
  formatTime24,
  formatTime12,
  parseTime,
  snapMinutes,
} from './datetime/date-utils.js';

/* ── pickers ─────────────────────────────────────────────────────────── */
export {
  ColorPicker,
  type ColorPickerConfig,
  type ColorPickerEvents,
  parseHex,
} from './pickers/color-picker.js';

export {
  FilePicker,
  type FilePickerConfig,
  type FilePickerEvents,
  type VaultFile,
  formatBytes,
} from './pickers/file-picker.js';

/* ── overlays ────────────────────────────────────────────────────────── */
export {
  Tooltip,
  type TooltipConfig,
  type TooltipEvents,
  type TooltipPlacement,
} from './overlays/tooltip.js';

export {
  Popup,
  type PopupConfig,
  type PopupEvents,
  type PopupPlacement,
  type PopupAlign,
  type PopupCloseReason,
} from './overlays/popup.js';

export { Mask, type MaskConfig, type MaskEvents } from './overlays/mask.js';

/* ── feedback ────────────────────────────────────────────────────────── */
export {
  MessageManager,
  type MessageManagerConfig,
  type MessageManagerEvents,
  type ToastVariant,
  type ToastPosition,
  type ToastOptions,
  type ToastHandle,
  type DialogVariant,
  type DialogOptions,
  type PromptOptions,
  alert,
  confirm,
  prompt,
} from './feedback/message-manager.js';

/* ── forms ───────────────────────────────────────────────────────────── */
export {
  Form,
  type FormConfig,
  type FormEvents,
  type FieldControl,
  type FieldValue,
  type FormValues,
  type RuleResult,
  type FieldRules,
  type FieldSchema,
  type FieldCondition,
  type FormFieldset,
  type FormLayout,
  type ValidationResult,
} from './forms/form.js';

export {
  TagsField,
  type TagsFieldConfig,
  type TagsFieldEvents,
} from './forms/tags-field.js';

/* ── layout ──────────────────────────────────────────────────────────── */
export {
  Layout,
  type LayoutConfig,
  type LayoutEvents,
  type RegionName,
  type RegionConfig,
  type CellContent,
} from './layout/layout.js';

export {
  Splitter,
  type SplitterConfig,
  type SplitterEvents,
  type SplitterOrientation,
  type SplitterPane,
} from './layout/splitter.js';

export {
  Panel,
  type PanelConfig,
  type PanelEvents,
  type PanelBody,
} from './layout/panel.js';

export {
  Container,
  type ContainerConfig,
  type ContainerEvents,
  type ContainerLayout,
  type FlexDirection,
  type AlignValue,
  type JustifyValue,
  type ContainerItem,
} from './layout/container.js';

/* ── nav ─────────────────────────────────────────────────────────────── */
export {
  Toolbar,
  type ToolbarConfig,
  type ToolbarEvents,
  type ToolbarItem,
} from './nav/toolbar.js';

export {
  Menu,
  type MenuConfig,
  type MenuEvents,
  type MenuItem,
} from './nav/menu.js';

export {
  ContextMenu,
  type ContextMenuConfig,
  type ContextMenuEvents,
  type ContextMenuCloseReason,
} from './nav/context-menu.js';

export {
  Sidebar,
  type SidebarConfig,
  type SidebarEvents,
  type SidebarItem,
} from './nav/sidebar.js';

export {
  Ribbon,
  type RibbonConfig,
  type RibbonEvents,
  type RibbonCommand,
  type RibbonGroup,
  type RibbonTab,
} from './nav/ribbon.js';

/* ── tabs ────────────────────────────────────────────────────────────── */
export {
  Tabbar,
  type TabbarConfig,
  type TabbarEvents,
  type TabItem,
  panelElementId,
} from './tabs/tabbar.js';

export {
  TabPanel,
  type TabPanelConfig,
  type TabPanelEvents,
  type TabPanelItem,
  type TabPanelContent,
} from './tabs/tab-panel.js';

export {
  Pagination,
  type PaginationConfig,
  type PaginationEvents,
} from './tabs/pagination.js';

/* ── windows ─────────────────────────────────────────────────────────── */
export {
  Window,
  type WindowConfig,
  type WindowEvents,
  type WindowCloseReason,
  type ResizeEdge,
} from './windows/window.js';

export {
  Dialog,
  type DialogConfig,
  type DialogEvents,
  type DialogAction,
} from './windows/dialog.js';

/* ── richtext ────────────────────────────────────────────────────────── */
export {
  RichText,
  type RichTextConfig,
  type RichTextEvents,
  type RichTextCommand,
  type RichTextToolbarItem,
  sanitizeHtml,
} from './richtext/rich-text.js';

/* ── data-views ──────────────────────────────────────────────────────── */
export {
  Tree,
  type TreeConfig,
  type TreeEvents,
  type TreeSelectionMode,
} from './data-views/tree.js';

export {
  List,
  type ListConfig,
  type ListEvents,
  type ListSelectionMode,
} from './data-views/list.js';

export {
  DataView,
  type DataViewConfig,
  type DataViewEvents,
  type DataViewSelectionMode,
} from './data-views/data-view.js';
