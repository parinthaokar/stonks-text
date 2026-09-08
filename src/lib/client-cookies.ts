/**
 * Tiny browser-side cookie writer.
 *
 * Lives in its own module because the React Compiler lint rules treat a direct
 * `document.cookie = ...` inside a component as mutating an outer-scope value.
 * The write is legitimate -- it happens in an event handler, not during render
 * -- so the fix is to move it behind a plain function rather than to reach for
 * an effect, which would run it at the wrong time for the wrong reason.
 *
 * Only for UI preferences. Anything the server must trust belongs in a server
 * action, since a cookie set here is fully under the client's control.
 */
export function setPreferenceCookie(name: string, value: string, maxAgeSeconds = 31_536_000) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAgeSeconds};samesite=lax`;
}
