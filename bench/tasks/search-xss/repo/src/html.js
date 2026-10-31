const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

exports.escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ENTITIES[char]);
