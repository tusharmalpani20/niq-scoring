import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "./button";
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
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn("pr-14", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="password-visibility-toggle"
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
      </Button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
