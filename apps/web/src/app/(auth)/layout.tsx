import { Logo } from '@/components/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sf-dark relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-6">
      {/* Subtle ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(ellipse,_rgba(37,99,235,0.1),_transparent_60%)] blur-2xl" />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <Logo className="mb-10" href="/" size="lg" />
        <div className="w-full max-w-md animate-fade-in">{children}</div>
      </div>
    </div>
  );
}
