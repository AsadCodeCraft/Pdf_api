const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { htmlToText } = require('html-to-text');
const { createClient } = require('@supabase/supabase-js');

const pdfDirectory = path.join(process.cwd(), 'generated-pdfs');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || 'pdfs';
const supabaseBucketPublic = process.env.SUPABASE_BUCKET_PUBLIC !== 'false';
const signedUrlExpiresIn = Number(process.env.SUPABASE_SIGNED_URL_EXPIRES_IN || 3600);
const useSupabaseStorage = Boolean(supabaseUrl && supabaseServiceRoleKey);

const supabase = useSupabaseStorage
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

function ensureLocalPdfDirectory() {
  if (!fs.existsSync(pdfDirectory)) {
    fs.mkdirSync(pdfDirectory, { recursive: true });
  }
}

function closeBrowser() {
  return Promise.resolve();
}

function mmToPoints(value) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return 28.35;
  }

  const trimmedValue = value.trim().toLowerCase();

  if (trimmedValue.endsWith('mm')) {
    return Number.parseFloat(trimmedValue) * 2.83465;
  }

  if (trimmedValue.endsWith('cm')) {
    return Number.parseFloat(trimmedValue) * 28.3465;
  }

  if (trimmedValue.endsWith('in')) {
    return Number.parseFloat(trimmedValue) * 72;
  }

  if (trimmedValue.endsWith('pt')) {
    return Number.parseFloat(trimmedValue);
  }

  return Number.parseFloat(trimmedValue) || 28.35;
}

function getPdfOptions(options = {}) {
  return {
    format: 'A4',
    margin: {
      top: '10mm',
      right: '10mm',
      bottom: '10mm',
      left: '10mm'
    },
    fontSize: 12,
    ...options
  };
}

function extractTextFromHtml(html) {
  return htmlToText(html, {
    wordwrap: 110,
    selectors: [
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
      { selector: 'img', format: 'skip' }
    ]
  }).trim();
}

function renderPdfBuffer(html, options = {}) {
  if (!html) {
    const error = new Error('HTML content is required');
    error.statusCode = 400;
    throw error;
  }

  const pdfOptions = getPdfOptions(options);
  const margin = pdfOptions.margin || {};
  const textContent = extractTextFromHtml(html) || ' ';

  return new Promise((resolve, reject) => {
    const chunks = [];
    const document = new PDFDocument({
      size: pdfOptions.format || 'A4',
      margins: {
        top: mmToPoints(margin.top),
        right: mmToPoints(margin.right),
        bottom: mmToPoints(margin.bottom),
        left: mmToPoints(margin.left)
      },
      info: {
        Title: pdfOptions.title || 'HTML Document',
        Author: 'html-to-pdf-api'
      }
    });

    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    document.font('Times-Roman');
    document.fontSize(Number(pdfOptions.fontSize) || 12);
    document.text(textContent, {
      align: pdfOptions.align || 'left'
    });
    document.end();
  });
}

async function storePdf(fileName, pdfBuffer, requestOrigin) {
  if (supabase) {
    const storagePath = `generated/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from(supabaseBucket)
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    if (supabaseBucketPublic) {
      const { data } = supabase.storage.from(supabaseBucket).getPublicUrl(storagePath);
      return {
        fileName,
        storage: 'supabase',
        path: storagePath,
        url: data.publicUrl,
        expiresIn: null
      };
    }

    const { data, error: signedUrlError } = await supabase.storage
      .from(supabaseBucket)
      .createSignedUrl(storagePath, signedUrlExpiresIn);

    if (signedUrlError) {
      throw signedUrlError;
    }

    return {
      fileName,
      storage: 'supabase',
      path: storagePath,
      url: data.signedUrl,
      expiresIn: signedUrlExpiresIn
    };
  }

  ensureLocalPdfDirectory();
  const filePath = path.join(pdfDirectory, fileName);
  fs.writeFileSync(filePath, pdfBuffer);

  return {
    fileName,
    storage: 'local',
    path: filePath,
    url: `${requestOrigin}/pdfs/${fileName}`,
    expiresIn: null
  };
}

async function convertHtmlToPdfUrl(html, options = {}, requestOrigin) {
  const pdfBuffer = await renderPdfBuffer(html, options);
  const fileName = `document-${Date.now()}-${crypto.randomUUID()}.pdf`;
  return storePdf(fileName, pdfBuffer, requestOrigin);
}

async function convertHtmlToBase64(html, options = {}) {
  const pdfBuffer = await renderPdfBuffer(html, options);
  return {
    success: true,
    pdf: pdfBuffer.toString('base64'),
    mimeType: 'application/pdf'
  };
}

module.exports = {
  closeBrowser,
  convertHtmlToBase64,
  convertHtmlToPdfUrl,
  ensureLocalPdfDirectory,
  getPdfOptions,
  pdfDirectory,
  useSupabaseStorage,
  supabaseBucket
};
