import { describe, expect, it } from "vitest";
import { translateAuthError, translatePasswordChangeError } from "@/lib/auth-errors";
import { authErrorKey, RESET_PASSWORD_PATH, safeNext } from "@/lib/validation";

// Recuperar la contraseña: el enlace del correo, el aviso cuando no sirve y los errores de Supabase en español.

describe("enlace para crear una contraseña nueva", () => {
  it("lleva a una ruta interna", () => {
    expect(safeNext(RESET_PASSWORD_PATH)).toBe("/restablecer");
  });

  it("si el enlace no sirve, /login explica cómo pedir otro", () => {
    expect(authErrorKey("/restablecer", "auth")).toBe("reset");
    expect(authErrorKey("/restablecer?desde=correo", "confirm")).toBe("reset");
    expect(authErrorKey("/inicio", "auth")).toBe("auth");
    expect(authErrorKey("/inicio", "confirm")).toBe("confirm");
    expect(authErrorKey("/restablecer-otra", "auth")).toBe("auth");
  });
});

describe("errores al entrar o al pedir el enlace", () => {
  it("pide esperar si se piden enlaces muy seguido", () => {
    expect(translateAuthError("For security purposes, you can only request this after 52 seconds.")).toBe(
      "Espera un minuto antes de pedir otro enlace.",
    );
    expect(translateAuthError("email rate limit exceeded")).toBe("Demasiados intentos. Espera un momento y vuelve a probar.");
  });

  it("sin correo propio en Supabase, ofrece escribir a soporte", () => {
    expect(translateAuthError("Email address not authorized")).toMatch(/^No pudimos enviar el correo\. Escríbenos a \S+@\S+ y te ayudamos a entrar\.$/);
  });

  it("los de siempre siguen igual", () => {
    expect(translateAuthError("Invalid login credentials")).toBe("Correo o contraseña incorrectos.");
    expect(translateAuthError("Email not confirmed")).toBe("Confirma tu correo antes de entrar. Revisa tu bandeja de entrada.");
    expect(translateAuthError("User already registered")).toBe("Ya existe una cuenta con ese correo. Entra con tu contraseña.");
    expect(translateAuthError("Password should be at least 6 characters")).toBe("Revisa la contraseña: usa al menos 8 caracteres.");
    expect(translateAuthError("algo inesperado")).toBe("No pudimos completar el acceso. Inténtalo de nuevo.");
  });
});

describe("errores al guardar la contraseña nueva", () => {
  it("explica cada caso", () => {
    expect(translatePasswordChangeError("New password should be different from the old password.")).toBe(
      "Elige una contraseña distinta a la anterior.",
    );
    expect(translatePasswordChangeError("Auth session missing!")).toBe("El enlace venció. Pide uno nuevo con «¿Olvidaste tu contraseña?».");
    expect(translatePasswordChangeError("Password is known to be weak and easy to guess, please choose a different one.")).toBe(
      "Esa contraseña es muy fácil de adivinar o apareció en filtraciones. Elige otra.",
    );
    expect(translatePasswordChangeError("Password should be at least 8 characters.")).toBe("Usa al menos 8 caracteres.");
    expect(translatePasswordChangeError("Request rate limit reached")).toBe("Demasiados intentos. Espera un momento y vuelve a probar.");
    expect(translatePasswordChangeError("???")).toBe("No pudimos guardar la contraseña. Inténtalo de nuevo.");
  });
});
