# Administration UI conventions

The NIQ staff console provides Overview, Users, Clients, Deployments, and Rules pages. Administrators set up individual accounts, provision clients and deployments, manage allowances and rule assignments, and inspect usage. The deployment activation token is shown once; the consuming application exchanges it for a deployment credential. See the repository [setup guide](../../README.md), [administrator accounts](../../docs/authentication.md), and [rule lifecycle](../../docs/architecture.md#rule-lifecycle).

The Rules page distinguishes the current default version from other active versions. Changing the default affects only new assessments on deployments following it. Existing assessments retain their bound version; retiring a version prevents new bindings but does not change historical assessment evidence. The confirmed final assessment profile still requires normal validation and approval before it is available for clinical use.

## UI implementation

Use official shadcn/ui components for UI primitives. Do not introduce custom replacements where shadcn provides a component. Page components and form bindings should compose those primitives and contain application behavior only.

All colors are defined as semantic CSS variables in `src/styles.css`. Change `--primary` and `--secondary` there; buttons, focus indicators, sidebar states, and other components consume the shared theme. Do not hard-code brand colors in individual components.

The sidebar uses shadcn Sidebar, mobile navigation uses its Sheet, and password visibility uses shadcn Input Group. Tables, cards, badges, alerts, fields, inputs, and buttons use their corresponding shadcn components.
