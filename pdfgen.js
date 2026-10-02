// pdfgen.js — certificate PDF generation.
//
// Has no Electron dependencies, so it can be unit-tested in plain Node.
const { PDFDocument, StandardFonts, TextAlignment } = require('pdf-lib');

/**
 * Fill the EASY certificate template.
 *
 * @param {Buffer|Uint8Array} templateBytes - raw bytes of EASY_CertTemplate.pdf
 * @param {object} fields
 * @param {string} fields.studentName
 * @param {string} fields.certificateNumber
 * @param {string} fields.completionDate   YYYY-MM-DD
 * @param {string} fields.expiryDate       YYYY-MM-DD
 * @param {string} fields.instructorName
 * @param {string} fields.pdfCourseName    display name, incl. forklift class suffix
 * @param {boolean} fields.isWpnl          Workplace NL category?
 * @param {string} fields.wpnlControl      Workplace NL control number (if isWpnl)
 * @returns {Promise<Buffer>} the flattened certificate PDF
 */
async function fillCertificatePdf(templateBytes, fields) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const set = (name, value) => {
    try {
      form.getTextField(name).setText(value ?? '');
    } catch (err) {
      throw new Error(`PDF template is missing the field "${name}".`);
    }
  };

  set('stud_name', fields.studentName);
  set('cert_no', fields.certificateNumber);
  set('iss_date', fields.completionDate);
  set('exp_date', fields.expiryDate);
  set('ins_name', fields.instructorName);
  set('ins_no', 'ES-01');
  set('course_name', fields.pdfCourseName);

  if (fields.isWpnl) {
    set('extrafield_label', 'Ctr #:');
    set('extrafield_desc', fields.wpnlControl);
  } else {
    set('extrafield_label', '');
    set('extrafield_desc', '');
  }

  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  // The template leaves stud_name without an alignment entry (left-aligned
  // by default), so short names sit left of center under the heading while
  // the (centered) course name does not. Center it before baking appearances.
  // This is code-side so it survives template edits that forget /Q.
  form.getTextField('stud_name').setAlignment(TextAlignment.Center);
  for (const field of form.getFields()) {
    try {
      field.updateAppearances(timesRoman);
    } catch (err) {
      // Non-text fields have no appearance to update; safe to skip.
    }
  }
  form.flatten();

  return Buffer.from(await pdfDoc.save());
}

module.exports = { fillCertificatePdf };
