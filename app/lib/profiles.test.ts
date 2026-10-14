import { describe, expect, it, vi } from "vitest";

import { ensureProfile } from "./profiles";

describe("ensureProfile", () => {
  it("crea la fila propia con el email del usuario", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: () => ({ upsert }),
    } as unknown as Parameters<typeof ensureProfile>[0];

    await ensureProfile(supabase, { id: "u1", email: "a@b.c" });

    expect(upsert).toHaveBeenCalledWith(
      { id: "u1", email: "a@b.c" },
      { onConflict: "id", ignoreDuplicates: true },
    );
  });

  it("no pisa la fila si ya existe (ignoreDuplicates), ni la moneda", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: () => ({ upsert }),
    } as unknown as Parameters<typeof ensureProfile>[0];

    await ensureProfile(supabase, { id: "u1", email: null });

    expect(upsert).toHaveBeenCalledWith(
      { id: "u1", email: "" },
      { onConflict: "id", ignoreDuplicates: true },
    );
  });

  it("nunca escribe un id distinto del usuario autenticado", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: () => ({ upsert }),
    } as unknown as Parameters<typeof ensureProfile>[0];

    await ensureProfile(supabase, { id: "u9" });

    const [payload] = upsert.mock.calls[0];
    expect(payload).toEqual({ id: "u9", email: "" });
  });
});
