# Contextual user feedback

The implementation follows these first-party patterns, checked 2026-10-09:

- **Onshape** opens support reporting within the working document, with optional document sharing, screenshots and annotation. Document support access is temporary and revocable. [Onshape support help](https://cad.onshape.com/help/Content/Home/contact_support.htm)
- **Marker.io** supports custom application metadata alongside reports and configurable client-side masking of sensitive screen content. [Custom metadata](https://help.marker.io/en/articles/5358889-custom-metadata), [sensitive-data masking](https://help.marker.io/en/articles/9657817-sensitive-data-masking)
- **Sentry** offers screenshots and cropping within user feedback. [Screenshot release notes](https://sentry.io/changelog/user-feedback-widget-screenshots/)
- **Linear** connects customer feedback to engineering issues and preserves source context. This would be a downstream workflow if email later becomes insufficient. [Customer requests](https://linear.app/docs/customer-requests)

For StageHarbour, the chosen approach is a built-in dialog using the existing mail transport: one required message, inferred page/editor context, screenshot preview/removal, and an explicit opt-in design snapshot. No separate feedback service, AI interpretation, replay, or image editor is required. The user still supplies intent; current state cannot reliably determine what they expected.

Automatic screenshots cover visible 2D/3D work panes rather than the entire application. Other pages accept pasted/uploaded images. Captures can be skipped; screenshot failure does not prevent a report. Current design snapshots contain model data and references, not model/underlay binaries or a restorable project archive. Work context and recent activity can be excluded independently.

Brevo's transactional email API supports Reply-To and base64 attachments, but its documented attachment extension list excludes `.json`. Both transports therefore use `.json.txt` for diagnostic JSON. [Brevo transactional email API](https://developers.brevo.com/reference/send-transac-email)

Configuration, size limits, retention and deployment checks are documented in [the CapRover guide](caprover.md#optional-user-feedback-by-email).
