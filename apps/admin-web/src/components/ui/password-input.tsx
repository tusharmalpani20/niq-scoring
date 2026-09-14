import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton } from "./input-group";
import { Input } from "./input";
import { cn } from "../../lib/utils";

// Compose the shadcn input and button so secret fields retain normal form behavior.
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof Input> & { visibilityLabel?: string }
>(({ className, type: _type, visibilityLabel = "password", ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // A form reset must not leave the next password visible.
    if (!props.value) setVisible(false);
  }, [props.value]);

  return (
    <InputGroup className="overflow-hidden">
      <InputGroupInput
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn("text-foreground", className)}
      />
      <InputGroupAddon align="inline-end" className="self-stretch border-l bg-accent p-0">
      <InputGroupButton
        type="button"
        variant="ghost"
        size="icon-sm"
        className="m-0! h-full w-11 rounded-none text-primary hover:bg-secondary"
        aria-label={`${visible ? "Hide" : "Show"} ${visibilityLabel}`}
        aria-controls={props.id}
        aria-pressed={visible}
        disabled={props.disabled}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? (
          <EyeOff aria-hidden="true" size={18} />
        ) : (
          <Eye aria-hidden="true" size={18} />
        )}
      </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
});
PasswordInput.displayName = "PasswordInput";
