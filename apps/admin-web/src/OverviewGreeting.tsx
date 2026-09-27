import { useEffect, useState } from "react";
import { GreetingIllustration } from "./components/GreetingIllustration";

function greetingForHour(hour: number) {
  if (hour >= 6 && hour < 12) return { text: "Good morning", period: "morning" } as const;
  if (hour >= 12 && hour < 18) return { text: "Good afternoon", period: "afternoon" } as const;
  return { text: "Good evening", period: "evening" } as const;
}

export function OverviewGreeting({ displayName }: { displayName: string }) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const greeting = greetingForHour(time.getHours());

  return <div className="flex min-w-0 items-center gap-4">
    <GreetingIllustration period={greeting.period} />
    <h1 className="m-0 text-2xl font-semibold tracking-tight sm:text-3xl">{greeting.text}, {displayName}!</h1>
  </div>;
}
