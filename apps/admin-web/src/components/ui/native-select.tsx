import * as React from "react"
import { cn } from "../../lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"

const EMPTY_VALUE = "__native_select_empty__"

type NativeSelectProps = Omit<React.ComponentPropsWithoutRef<"button">, "children" | "value" | "defaultValue" | "onChange" | "onBlur" | "onFocus"> & {
  size?: "sm" | "default"
  children?: React.ReactNode
  value?: string | number | readonly string[]
  defaultValue?: string | number | readonly string[]
  onChange?: React.ChangeEventHandler<HTMLSelectElement>
  onBlur?: React.FocusEventHandler<HTMLButtonElement>
  onFocus?: React.FocusEventHandler<HTMLButtonElement>
  required?: boolean
}

type SelectOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean | undefined
  key: React.Key
}

function collectOptions(children: React.ReactNode, options: SelectOption[] = []) {
  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return
    const element = child as React.ReactElement<{ children?: React.ReactNode }>
    if (child.type === React.Fragment) {
      collectOptions(element.props.children, options)
      return
    }
    if (child.type === NativeSelectOptGroup || child.type === "optgroup") {
      collectOptions(element.props.children, options)
      return
    }
    if (child.type !== NativeSelectOption && child.type !== "option") return
    const optionProps = child.props as React.ComponentProps<"option">
    options.push({
      value: optionProps.value == null ? "" : String(optionProps.value),
      label: optionProps.children,
      disabled: optionProps.disabled,
      key: child.key ?? `${options.length}`,
    })
  })
  return options
}

function normalizeValue(value: NativeSelectProps["value"]) {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw == null) return undefined
  const stringValue = String(raw)
  return stringValue === "" ? EMPTY_VALUE : stringValue
}

/**
 * Compatibility adapter for the existing select call sites. The rendered
 * control is the shared Radix select so legacy option-based consumers get the
 * same popup and focus treatment as the rest of the admin UI.
 */
const NativeSelect = React.forwardRef<HTMLButtonElement, NativeSelectProps>(function NativeSelect({
  className,
  size = "default",
  children,
  value,
  defaultValue,
  onChange,
  onBlur,
  onFocus,
  name,
  required,
  ...props
}, ref) {
  const options = collectOptions(children)
  const emptyOption = options.find(option => option.value === "")
  const normalizedValue = normalizeValue(value)
  const normalizedDefaultValue = normalizeValue(defaultValue)
  const emitChange = (nextValue: string) => {
    const actualValue = nextValue === EMPTY_VALUE ? "" : nextValue
    const target = { value: actualValue } as HTMLSelectElement
    onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>)
  }

  return (
    <Select
      {...(normalizedValue === undefined ? {} : { value: normalizedValue })}
      {...(normalizedDefaultValue === undefined ? {} : { defaultValue: normalizedDefaultValue })}
      onValueChange={emitChange}
      {...(name === undefined ? {} : { name })}
      {...(required === undefined ? {} : { required })}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
    >
      <SelectTrigger
        {...props}
        ref={ref}
        data-size={size}
        onBlur={onBlur}
        onFocus={onFocus}
        className={cn(size === "sm" && "h-8 py-1", className)}
      >
        <SelectValue placeholder={emptyOption?.label ?? "Select…"} />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.key} value={option.value === "" ? EMPTY_VALUE : option.value} {...(option.disabled === undefined ? {} : { disabled: option.disabled })}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
})

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
