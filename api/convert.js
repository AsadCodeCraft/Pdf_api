require('dotenv').config();

const { convertHtmlToPdfUrl } = require('../lib/pdf-service');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { html, options = {} } = req.body || {};
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const requestOrigin = `${protocol}://${host}`;

    const storedPdf = await convertHtmlToPdfUrl(html, options, requestOrigin);

    return res.status(200).json({
      success: true,
      fileName: storedPdf.fileName,
      storage: storedPdf.storage,
      path: storedPdf.path,
      url: storedPdf.url,
      expiresIn: storedPdf.expiresIn
    });
  } catch (error) {
    console.error('Error converting HTML to PDF:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Failed to convert HTML to PDF',
      message: error.message
    });
  }
};
