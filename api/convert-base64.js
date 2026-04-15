require('dotenv').config();

const { convertHtmlToBase64 } = require('../lib/pdf-service');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { html, options = {} } = req.body || {};
    const result = await convertHtmlToBase64(html, options);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error converting HTML to PDF:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Failed to convert HTML to PDF',
      message: error.message
    });
  }
};
