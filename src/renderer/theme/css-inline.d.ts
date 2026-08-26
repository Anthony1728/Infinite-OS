/**
 * Ambient type for Vite's `?inline` CSS imports, which return the compiled
 * stylesheet as a string instead of injecting it. Not declared by vite/client.
 */
declare module '*.css?inline' {
  const css: string;
  export default css;
}
