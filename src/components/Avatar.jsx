import { initials } from "../data/technicians";

const sizes = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
  xl: "h-20 w-20 text-2xl",
};

export default function Avatar({ name, color = "bg-slate-500", size = "md", className = "" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${color} ${sizes[size]} ${className}`}
    >
      {initials(name)}
    </span>
  );
}
