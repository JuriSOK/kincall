import { describe, expect, it } from "vitest";
import { isE164, maskPhone } from "@/lib/phone";

describe("isE164", () => {
  it("accepts a valid E.164 number", () => {
    expect(isE164("+33639980001")).toBe(true);
  });

  it("rejects a number containing spaces or masking characters", () => {
    expect(isE164("+33 6 39 98 00 01")).toBe(false);
    expect(isE164("+33•••••••01")).toBe(false);
  });

  it("rejects a number without a country prefix or with a leading zero", () => {
    expect(isE164("0639980001")).toBe(false);
    expect(isE164("+0639980001")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("keeps the country prefix and the last two digits", () => {
    expect(maskPhone("+33639980001")).toBe("+33•••••••01");
  });

  it("never leaks enough digits to dial the number", () => {
    const masked = maskPhone("+33639980001");
    expect(masked).not.toContain("639980");
    expect(masked).toHaveLength("+33639980001".length);
  });

  it("masks a very short value entirely", () => {
    expect(maskPhone("+331")).toBe("••••");
  });
});
