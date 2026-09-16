# Subprocessors

Updated: {{effectiveDate}}

| Subprocessor | Role | Data | Location |
| --- | --- | --- | --- |
| {{hostingProvider}} | Server hosting | Encrypted data, emails, session metadata | {{hostingLocation}} |
{{#si billing}}| Stripe Payments Europe, Ltd. | Plan payments | Stripe customer and subscription identifiers, payment data entered directly with Stripe | Ireland (EU) |{{/si}}
{{#si emails}}| The Operator's SMTP provider | Sending security emails | Email address, content of security emails | To be specified by the Operator |{{/si}}
{{#si backups}}| The Operator's S3 storage provider | Backups | Encrypted copies of the database and attachments | To be specified by the Operator |{{/si}}

Session locations are looked up in a database installed on the server: no data is sent to a geolocation service.

Any change to this list is announced to client organisations at least 30 days in advance, and they may object.
