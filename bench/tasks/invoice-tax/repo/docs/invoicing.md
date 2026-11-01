# Invoicing rules

From the accountant, so the invoices match the books:

- Every amount is an integer number of cents.
- VAT is worked out per line: the tax of a line is its net amount times the VAT rate, rounded to the nearest cent, with half a cent rounded up.
- The invoice tax is the sum of the line taxes. The invoice total is the subtotal plus the invoice tax.
- Each line of the invoice shows its net amount and its tax.
