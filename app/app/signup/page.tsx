import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Crear cuenta | Flight Deal Tracker",
};

export default async function SignupPage() {
  const { SignUpForm } = await import("@/components/auth/signup-form");

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <SignUpForm />
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/" className="underline underline-offset-4">
            Volver al inicio
          </Link>
        </p>
      </div>
    </main>
  );
}