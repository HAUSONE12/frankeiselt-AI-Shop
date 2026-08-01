import { Router } from 'express';
import { z } from 'zod';
import { getSignedPlentyInvoice } from '../services/plenty-invoices.js';

export const invoiceRouter = Router();

invoiceRouter.get('/plenty/:orderId/:documentId', async (req, res, next) => {
  try {
    const params = z.object({
      orderId: z.coerce.number().int().positive(),
      documentId: z.coerce.number().int().positive(),
    }).parse(req.params);
    const query = z.object({
      token: z.string().regex(/^[a-f0-9]{64}$/i),
    }).parse(req.query);

    const invoice = await getSignedPlentyInvoice(
      params.orderId,
      params.documentId,
      query.token,
    );

    const safeFileName = invoice.fileName.replace(/[\r\n"\\/]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(invoice.bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'INVALID_INVOICE_TOKEN') {
      return res.status(403).json({ error: 'Invalid invoice link.' });
    }
    if (
      message === 'ORDER_NOT_FOUND'
      || message === 'DOCUMENT_NOT_FOUND'
      || message === 'INVOICE_NOT_ATTACHED_TO_ORDER'
    ) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    return next(error);
  }
});
