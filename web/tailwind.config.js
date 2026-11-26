/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Nunito", "system-ui", "sans-serif"] },
      colors: {
        ground: "#FFFBF2",
        ink: "#2E2449",
        body: "#463C63",
        muted: "#6B6385",
        line: "#EFE5D3",
        soft: "#F7EFE0",
        // "roxo" é a cor de destaque da área atual (roxo na Aphago, vinho na Abrasso), definida no Layout
        roxo: {
          DEFAULT: "rgb(var(--accent, 124 92 224) / <alpha-value>)",
          claro: "rgb(var(--accent-claro, 228 220 255) / <alpha-value>)",
          texto: "rgb(var(--accent-texto, 91 63 196) / <alpha-value>)",
          escuro: "rgb(var(--accent-escuro, 69 48 154) / <alpha-value>)",
        },
        aphago: "#7C5CE0",
        abrasso: "#9D2235",
        laranja: "#E39A6F",
        sol: "#FFD447",
        coral: "#FF7A7A",
        lavanda: "#A797C9",
        bom: "#1F7A4D",
        ruim: "#B42318",
      },
    },
  },
  plugins: [],
};
