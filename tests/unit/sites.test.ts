import { describe, expect, it } from "vitest";
import {
  assembleContent,
  asksForSecrets,
  cleanText,
  contactLinks,
  copyText,
  ctaLabelFor,
  formatIntlNumber,
  normalizeContact,
  pickPalette,
  primaryLink,
  reviewCopy,
  rulesCopy,
  slugBase,
  slugFor,
  SLUG_PATTERN,
  unsupportedNumbers,
} from "@/modules/sites/sites.rules";
import { PALETTE_IDS, siteBriefSchema, siteContentSchema, type SiteBrief, type SiteCopy } from "@/modules/sites/sites.types";

// Páginas web de Omni: dirección, contacto y enlaces (solo los de la persona), revisión del texto (sin cifras
// inventadas, sin direcciones ajenas, sin pedir claves) y la página por reglas cuando no hay IA.

const brief: SiteBrief = siteBriefSchema.parse({
  name: "Dulce Hogar",
  about: "Repostería casera en Caracas. Hacemos tortas por encargo y postres para eventos. Entregamos a domicilio en toda la ciudad.",
  goal: "vender",
  offerings: ["Tortas por encargo", "Postres para eventos", "Cupcakes"],
  prices: "Torta de 1 kg: $25\nDocena de cupcakes - $15",
  contact: { whatsapp: "+58 414-555-0101", instagram: "https://www.instagram.com/dulcehogar.ccs/", hours: "Lunes a sábado, de 9:00 a 18:00" },
});

function copy(overrides: Partial<SiteCopy> = {}): SiteCopy {
  return {
    tagline: "Repostería casera",
    hero: { headline: "Tortas por encargo en Caracas", subheadline: "Postres para tus fiestas.", ctaLabel: "Haz tu pedido por WhatsApp" },
    sections: [
      {
        kind: "features",
        title: "Lo que hacemos",
        items: [
          { title: "Tortas", text: "A tu gusto.", icon: "corazon" },
          { title: "Postres", text: "Para eventos.", icon: "regalo" },
        ],
      },
      { kind: "about", title: "Sobre nosotros", text: "Repostería casera hecha con cariño." },
    ],
    closing: { title: "¿Hablamos?", text: "Escríbenos." },
    palette: "atardecer",
    ...overrides,
  };
}

describe("páginas web: dirección", () => {
  it("el nombre sin tildes ni símbolos, con un sufijo que no se adivina", () => {
    expect(slugBase("Café Ñandú & Co.")).toBe("cafe-nandu-co");
    expect(slugBase("¡¡!!")).toBe("pagina");
    expect(slugBase("x".repeat(80))).toHaveLength(40);
    const slug = slugFor("Dulce Hogar", "k3x9qa");
    expect(slug).toBe("dulce-hogar-k3x9qa");
    expect(SLUG_PATTERN.test(slug)).toBe(true);
    expect(SLUG_PATTERN.test("../admin")).toBe(false);
  });
});

describe("páginas web: contacto y enlaces", () => {
  it("normaliza lo que dio la persona y descarta lo que no sirve", () => {
    expect(normalizeContact(brief.contact)).toEqual({
      whatsapp: "584145550101",
      phone: null,
      email: null,
      instagram: "dulcehogar.ccs",
      website: null,
      address: null,
      hours: "Lunes a sábado, de 9:00 a 18:00",
    });
    const odd = normalizeContact({ whatsapp: "123", phone: "(0212) 555-0101", website: "javascript:alert(1)", instagram: "@ mala cuenta", email: "Hola@Dulce.com" });
    expect(odd).toMatchObject({ whatsapp: null, phone: "(0212) 555-0101", website: null, instagram: null, email: "hola@dulce.com" });
    expect(normalizeContact({ website: "dulcehogar.com" }).website).toBe("https://dulcehogar.com/");
    expect(normalizeContact({ website: "http://dulcehogar.com" }).website).toBeNull();
    expect(normalizeContact({ website: "https://user:clave@dulce.com" }).website).toBeNull();
  });

  it("los enlaces salen solo del contacto, con WhatsApp primero", () => {
    const links = contactLinks(normalizeContact({ ...brief.contact, email: "hola@dulce.com", phone: "+58 212 555 0101" }));
    expect(links.map((l) => [l.kind, l.href])).toEqual([
      ["whatsapp", "https://wa.me/584145550101"],
      ["phone", "tel:+582125550101"],
      ["email", "mailto:hola@dulce.com"],
      ["instagram", "https://instagram.com/dulcehogar.ccs"],
    ]);
    expect(primaryLink(normalizeContact({}))).toBeNull();
  });

  it("el WhatsApp se muestra fácil de leer, con el código de país aparte", () => {
    expect(contactLinks(normalizeContact({ whatsapp: "+584145550101" }))[0]?.detail).toBe("+58 414 555 0101");
    expect(formatIntlNumber("13055550101")).toBe("+1 305 555 0101");
    expect(formatIntlNumber("34612345678")).toBe("+34 612 345 678");
    expect(formatIntlNumber("50688889999")).toBe("+506 8888 9999");
    expect(formatIntlNumber("573001234567")).toBe("+57 300 123 4567");
    expect(formatIntlNumber("5491112345678")).toBe("+54 911 1234 5678");
  });

  it("el botón dice qué pasa al tocarlo", () => {
    const wa = primaryLink(normalizeContact({ whatsapp: "584145550101" }));
    expect(ctaLabelFor("vender", wa)).toBe("Haz tu pedido por WhatsApp");
    expect(ctaLabelFor("reservas", primaryLink(normalizeContact({ phone: "02125550101" })))).toBe("Reserva por teléfono");
    expect(ctaLabelFor("contacto", null)).toBe("Conoce más");
    for (const goal of ["vender", "reservas", "contacto", "portafolio", "evento", "informar"] as const) {
      expect(ctaLabelFor(goal, wa).length).toBeLessThanOrEqual(32);
    }
  });
});

describe("páginas web: revisión del texto", () => {
  it("encuentra cifras que la persona no dio (sin importar separadores)", () => {
    const source = "Torta de 1 kg: $25. Docena: $1.500. Abrimos de 9:00 a 18:00";
    expect(unsupportedNumbers(copy({ tagline: "Más de 10 años y 5.000 clientes" }), source)).toEqual(["10", "5000"]);
    expect(unsupportedNumbers(copy({ tagline: "Tortas desde $25, docena a 1500" }), source)).toEqual([]);
    expect(unsupportedNumbers(copy({ tagline: "Atendemos 24/7" }), source)).toEqual(["24"]);
  });

  it("quita las frases con cifras inventadas sin romper la página", () => {
    const review = reviewCopy(
      copy({
        hero: { headline: "Tortas por encargo", subheadline: "Más de 10 años endulzando Caracas. Postres para tus fiestas.", ctaLabel: "Pide ya" },
        sections: [
          {
            kind: "pricing",
            title: "Precios",
            items: [
              { name: "Torta de 1 kg", price: "$25", detail: "" },
              { name: "Mesa dulce", price: "$80", detail: "" },
            ],
            note: "",
          },
        ],
      }),
      brief,
    );
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.copy.hero.subheadline).toBe("Postres para tus fiestas.");
    expect(review.copy.sections).toEqual([
      { kind: "pricing", title: "Precios", items: [{ name: "Torta de 1 kg", price: "$25", detail: "" }], note: "" },
    ]);
    expect(review.fixes.join(" ")).toMatch(/80/);
  });

  it("quita direcciones web y código del texto: los enlaces los pone Omni", () => {
    expect(cleanText("Visita https://phishing.test/login y <b>compra</b> **ya**")).toBe("Visita y compra ya");
    expect(cleanText("Primer párrafo.\n\n\n\nSegundo   párrafo.")).toBe("Primer párrafo.\n\nSegundo párrafo.");
    const review = reviewCopy(copy({ tagline: "Pide en www.otra-tienda.test" }), brief);
    expect(review.ok && review.copy.tagline).toBe("Pide en");
    expect(review.ok && review.fixes[0]).toMatch(/direcciones web/);
  });

  it("rechaza una página que pide claves o datos de tarjeta", () => {
    expect(asksForSecrets(copy({ tagline: "Ingresa tu contraseña para recibir el premio" }))).toBe(true);
    expect(asksForSecrets(copy({ tagline: "Envíanos tu número de tarjeta" }))).toBe(true);
    expect(asksForSecrets(copy({ tagline: "Nunca te pediremos claves" }))).toBe(false);
    const review = reviewCopy(copy({ tagline: "Confirma tus datos bancarios aquí" }), brief);
    expect(review.ok).toBe(false);
  });

  it("si de una sección no queda nada, se cae; si no queda ninguna, usa las de reglas", () => {
    const review = reviewCopy(
      copy({ sections: [{ kind: "about", title: "Historia", text: "Desde 1998 con 300 sucursales." }] }),
      brief,
    );
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.copy.sections.length).toBeGreaterThan(0);
    expect(copyText(review.copy)).not.toMatch(/1998|300/);
  });
});

describe("páginas web: sin IA", () => {
  it("arma una página válida solo con las palabras de la persona", () => {
    const rules = rulesCopy(brief);
    expect(unsupportedNumbers(rules, [brief.name, brief.about, ...brief.offerings, brief.prices, brief.contact.hours].join("\n"))).toEqual([]);
    expect(rules.hero.headline).toBe("Repostería casera en Caracas");
    expect(rules.hero.ctaLabel).toBe("Haz tu pedido por WhatsApp");
    const kinds = rules.sections.map((section) => section.kind);
    expect(kinds).toContain("features");
    expect(rules.sections.find((section) => section.kind === "pricing")).toEqual({
      kind: "pricing",
      title: "Precios",
      items: [
        { name: "Torta de 1 kg", price: "$25", detail: "" },
        { name: "Docena de cupcakes", price: "$15", detail: "" },
      ],
      note: "",
    });
    const content = assembleContent(brief, rules);
    expect(siteContentSchema.safeParse(content).success).toBe(true);
    expect(content.name).toBe("Dulce Hogar");
  });

  it("precios que no se pueden ordenar quedan tal cual, en un bloque", () => {
    const loose = rulesCopy({ ...brief, prices: "Consultar por WhatsApp según el diseño" });
    expect(loose.sections.find((s) => s.title === "Precios")).toMatchObject({ kind: "about", text: "Consultar por WhatsApp según el diseño" });
  });

  it("la paleta elegida manda; si no hay, sale siempre la misma para el mismo nombre", () => {
    expect(assembleContent({ ...brief, palette: "oceano" }, copy()).palette).toBe("oceano");
    expect(assembleContent({ ...brief, palette: undefined }, copy({ palette: "grafito" })).palette).toBe("grafito");
    expect(pickPalette("Dulce Hogar")).toBe(pickPalette("Dulce Hogar"));
    expect(PALETTE_IDS).toContain(pickPalette("Otra cosa"));
  });
});
