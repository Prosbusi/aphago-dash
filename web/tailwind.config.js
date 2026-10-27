/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Manrope", "system-ui", "sans-serif"] },
      colors: {
        ground: "#F6F4EF",
        ink: "#17171A",
        body: "#3B3934",
        muted: "#5E5B55",
        line: "#E4E0D8",
        soft: "#EEEBE4",
        // "roxo" é a cor de destaque da área atual (roxo na Aphago, vinho na Abrasso), definida no Layout
        roxo: {
          DEFAULT: "rgb(var(--accent, 160 101 231) / <alpha-value>)",
          claro: "rgb(var(--accent-claro, 217 195 245) / <alpha-value>)",
          texto: "rgb(var(--accent-texto, 122 61 200) / <alpha-value>)",
          escuro: "rgb(var(--accent-escuro, 91 42 154) / <alpha-value>)",
        },
        aphago: "#A065E7",
        abrasso: "#9D2235",
        laranja: "#E39A6F",
        bom: "#1F7A4D",
        ruim: "#B42318",
      },
    },
  },
  plugins: [],
};
