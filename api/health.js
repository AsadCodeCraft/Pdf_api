require('dotenv').config();

module.exports = async (req, res) => {
  res.status(200).json({ status: 'OK', message: 'HTML to PDF API is running' });
};
