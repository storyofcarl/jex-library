/** Route: inputs. */
import { el, card } from '../shell/dom.js';
import { section } from '../shell/registry.js';
import { colors, fruits, plans } from '../shell/data.js';
import {
  TextField, NumberField, TextArea, DisplayField, Label, Link, Select, ComboBox,
  Checkbox, CheckboxGroup, RadioGroup, Switch, Slider, RangeSlider, Rating,
  ProgressBar, Badge, Avatar, Spacer, DatePicker, TimePicker, DateTimeField,
  MiniCalendar, ColorPicker, FilePicker,
} from '../shell/registry.js';

export function register() {
  section('inputs', 'Inputs', 'Text, number, area, choice, sliders, ratings, color & date pickers.', (grid) => {
    grid.appendChild(card('TextField', (h) => {
      new TextField(h, { label: 'Email', value: 'jane@example.com', inputType: 'email', clearable: true });
      new TextField(h, { label: 'Price', prefix: '$', suffix: 'USD', value: '19.99' });
      new TextField(h, { label: 'Email', value: 'nope', error: 'Enter a valid email' });
    }, { block: true }));
    grid.appendChild(card('NumberField', (h) => {
      new NumberField(h, { label: 'Volume', value: '50', min: 0, max: 100, step: 5 });
      new NumberField(h, { label: 'Amount', value: '9.5', precision: 2, prefix: '$' });
    }, { block: true }));
    grid.appendChild(card('TextArea', (h) => {
      new TextArea(h, { label: 'Tweet', maxLength: 280, value: 'Hello world' });
    }, { block: true }));
    grid.appendChild(card('DisplayField & Label', (h) => {
      new DisplayField(h, { label: 'Full name', value: 'Jane Doe' });
      new DisplayField(h, { label: 'Status', value: 'Active', layout: 'inline' });
      new Label(h, { text: 'Password', htmlFor: 'pw', required: true });
    }, { block: true }));
    grid.appendChild(card('Link', (h) => {
      new Link(h, { text: 'Read the docs', href: '#' });
      new Link(h, { text: 'Terms', href: '#', variant: 'underline' });
    }));
    grid.appendChild(card('Select', (h) => {
      new Select(h, { options: colors, placeholder: 'Choose a color', ariaLabel: 'Color', clearable: true });
    }, { block: true }));
    grid.appendChild(card('ComboBox (autocomplete + multi)', (h) => {
      new ComboBox(h, { options: fruits, placeholder: 'Search fruit…', ariaLabel: 'Fruit' });
      new ComboBox(h, { options: fruits, multiple: true, values: ['apple', 'cherry'], placeholder: 'Add fruit…', ariaLabel: 'Fruits' });
    }, { block: true }));
    grid.appendChild(card('Checkbox', (h) => {
      new Checkbox(h, { label: 'Remember me', checked: true });
      new Checkbox(h, { label: 'Select all', indeterminate: true });
    }, { block: true }));
    grid.appendChild(card('CheckboxGroup', (h) => {
      new CheckboxGroup(h, {
        options: [
          { value: 'cheese', label: 'Cheese' },
          { value: 'mushroom', label: 'Mushroom' },
          { value: 'olive', label: 'Olive' },
        ],
        value: ['cheese'], ariaLabel: 'Toppings',
      });
    }, { block: true }));
    grid.appendChild(card('Radio & RadioGroup', (h) => {
      new RadioGroup(h, { options: plans, value: 'pro', ariaLabel: 'Plan' });
    }, { block: true }));
    grid.appendChild(card('Switch', (h) => {
      new Switch(h, { label: 'Notifications', checked: true });
      new Switch(h, { label: 'Airplane mode' });
    }, { block: true }));
    grid.appendChild(card('Slider & RangeSlider', (h) => {
      new Slider(h, { min: 0, max: 100, value: 40, label: 'Volume' });
      new RangeSlider(h, { min: 0, max: 100, value: [25, 75] });
    }, { block: true }));
    grid.appendChild(card('Rating', (h) => {
      new Rating(h, { max: 5, value: 3.5, allowHalf: true });
    }));
    grid.appendChild(card('ColorPicker', (h) => {
      new ColorPicker(h, { value: '#00aeef', alpha: true });
    }));
    grid.appendChild(card('FilePicker', (h) => {
      new FilePicker(h, { hint: 'Images only — drag & drop', accept: 'image/*' });
    }, { block: true }));
    grid.appendChild(card('DatePicker', (h) => {
      new DatePicker(h, { value: new Date(2026, 5, 10) });
    }));
    grid.appendChild(card('TimePicker', (h) => {
      new TimePicker(h, { value: { hours: 9, minutes: 30 }, hour12: true });
    }));
    grid.appendChild(card('DateTimeField', (h) => {
      new DateTimeField(h, { value: new Date(2026, 5, 10, 9, 30) });
    }));
    grid.appendChild(card('MiniCalendar', (h) => {
      new MiniCalendar(h, { value: new Date(2026, 5, 10), viewDate: new Date(2026, 5, 10) });
    }));
    grid.appendChild(card('Avatar, Badge, ProgressBar, Spacer', (h) => {
      new Avatar(h, { name: 'Ada Lovelace' });
      new Badge(h, { text: 'Active', variant: 'success', dot: true });
      new Badge(h, { text: 'Cyan', variant: 'cyan' });
      new Spacer(h, { size: 'md' });
      const pb = el('div', { style: 'flex:1 1 100%' });
      h.appendChild(pb);
      new ProgressBar(pb, { value: 60, showLabel: true });
    }, { block: true }));
  });
}
