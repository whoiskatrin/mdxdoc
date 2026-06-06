import * as React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "ghost" | "outline" }) {
  const { className, variant = "default", ...rest } = props;
  return <button className={cn("inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition", variant === "default" && "bg-slate-900 text-white", variant === "ghost" && "hover:bg-slate-100", variant === "outline" && "border border-slate-300", className)} {...rest} />;
}

export function Badge(props: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs", props.className)} {...props} />;
}

export function Panel(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border bg-white shadow-sm", props.className)} {...props} />;
}
