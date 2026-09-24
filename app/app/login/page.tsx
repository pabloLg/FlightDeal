import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Iniciar sesión | Flight Deal Tracker",
};

export default async function LoginPage() {
  const { LoginForm } = await import("@/components/auth/login-form");

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <LoginForm />
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/" className="underline underline-offset-4">
            Volver al inicio
          </Link>
        </p>
      </div>
    </main>
  );
}