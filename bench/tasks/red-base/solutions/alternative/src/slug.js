const PLAIN = { á: "a", à: "a", â: "a", ã: "a", é: "e", ê: "e", í: "i", ó: "o", ô: "o", õ: "o", ú: "u", ü: "u", ç: "c" };

exports.{{fn}} = (title) =>
  [...title.toLowerCase()]
    .map((char) => PLAIN[char] ?? char)
    .join("")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
