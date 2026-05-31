// Renders the technician app inside a phone bezel on desktop so it demos on a
// laptop; goes full-bleed on real mobile screens.
export default function PhoneFrame({ children }) {
  return (
    <div className="min-h-[100svh] w-full bg-slate-200/70 md:flex md:items-center md:justify-center md:py-8">
      <div className="relative mx-auto flex h-[100svh] w-full max-w-[430px] flex-col overflow-hidden bg-slate-50 md:h-[880px] md:max-h-[92vh] md:rounded-[2.5rem] md:border-[10px] md:border-slate-900 md:shadow-2xl">
        {children}
      </div>
    </div>
  );
}
