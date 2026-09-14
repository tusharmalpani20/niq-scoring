# Administration UI conventions

Use official shadcn/ui components for UI primitives. Do not introduce custom replacements where shadcn provides a component. Page components and form bindings should compose those primitives and contain application behavior only.

All colors are defined as semantic CSS variables in `src/styles.css`. Change `--primary` and `--secondary` there; buttons, focus indicators, sidebar states, and other components consume the shared theme. Do not hard-code brand colors in individual components.

The sidebar uses shadcn Sidebar, mobile navigation uses its Sheet, and password visibility uses shadcn Input Group. Tables, cards, badges, alerts, fields, inputs, and buttons use their corresponding shadcn components.
