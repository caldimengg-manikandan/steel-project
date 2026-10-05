require('dotenv').config();
const mongoose = require('mongoose');

async function inspectZohoEmails() {
  await mongoose.connect(process.env.MONGO_URI);
  const Email = require('../src/modules/mail-router/mongoose/models/Email');
  const Attachment = require('../src/modules/mail-router/mongoose/models/Attachment');
  
  const zohoEmails = await Email.find({ provider: 'ZOHO' }).lean();
  console.log('Total Zoho emails in DB:', zohoEmails.length);

  for (const e of zohoEmails) {
    const hasCid = (e.bodyHtml || '').includes('cid:');
    const hasImg = (e.bodyHtml || '').includes('<img');
    const atts = await Attachment.find({ emailId: e._id }).lean();
    if (hasCid || hasImg || atts.length > 0) {
      console.log('\nSubject:', e.subject);
      console.log('  Email ID:', e._id, 'providerMessageId:', e.providerMessageId);
      console.log('  hasCid:', hasCid, 'hasImg:', hasImg, 'atts count:', atts.length);
      for (const a of atts) {
        console.log('    att:', a.filename, '| contentId:', a.contentId, '| isInline:', a.isInline, '| hasContent:', Boolean(a.content?.length));
      }
      if (hasImg) {
        const imgTags = (e.bodyHtml || '').match(/<img[^>]+>/gi) || [];
        console.log('    img tags sample:', imgTags.slice(0, 3));
      }
    }
  }

  await mongoose.disconnect();
}
inspectZohoEmails().catch(console.error);
