const PERSONAL =
  /^(?:e_?mail|phone(?:_?number)?|mobile|cell(?:phone)?|whatsapp|cpf|ssn|tax_?id|national_?id|passport|rg|document(?:_?number)?|birth_?(?:date|day)|date_?of_?birth|dob|address(?:_?line\d?)?|street|zip(?:_?code)?|postal_?code|first_?name|last_?name|full_?name|surname|gender|sex|ip(?:_?address)?|last_?ip|location|latitude|longitude|health\w*|diagnosis|medical\w*|salary|income|iban|bank_?account|card_?number|religion|ethnicity|biometric\w*|photo(?:_?url)?|avatar(?:_?url)?)$/i;
const PERSON_MODEL = /user|customer|person|people|member|patient|employee|contact|profile|client|lead|student|account/i;

export const isPersonalField = (model: string, field: string): boolean =>
  PERSONAL.test(field) || (/^name$/i.test(field) && PERSON_MODEL.test(model));
