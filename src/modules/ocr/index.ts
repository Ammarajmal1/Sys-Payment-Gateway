import { createWorker } from 'tesseract.js';
import { rupeesToPaisa } from '../../utils/currency.js';

export interface OcrExtractionResult {
  rawText: string;
  confidenceScore: number;
  detectedProvider?: 'easypaisa' | 'jazzcash' | 'bank_transfer' | 'other';
  extractedAmountPaisa?: number;
  extractedCurrency?: string;
  extractedTransactionId?: string;
  extractedDateTime?: string;
  extractedSenderName?: string;
  extractedSenderAccount?: string;
  extractedReceiverName?: string;
  extractedReceiverAccount?: string;
  status: 'completed' | 'failed' | 'low_confidence';
  extractionNotes: Record<string, unknown>;
}

/**
 * Deterministic Regex Parser for Pakistani Payment Receipts
 * Extracts transaction fields from raw OCR text.
 */
export function parseReceiptText(rawText: string, confidence = 0): OcrExtractionResult {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const notes: Record<string, unknown> = {
    untrustedOcrWarning: 'All extracted fields are derived from customer-uploaded images and are strictly UNTRUSTED.',
    rawLength: normalized.length,
  };

  // 1. Detect Provider
  let detectedProvider: 'easypaisa' | 'jazzcash' | 'bank_transfer' | 'other' = 'other';
  if (/easypaisa|telenor\s*bank/i.test(normalized)) {
    detectedProvider = 'easypaisa';
  } else if (/jazzcash|mobilink\s*bank/i.test(normalized)) {
    detectedProvider = 'jazzcash';
  } else if (/bank|meezan|hbl|alfalah|ubl|mcb|faysal|standard\s*chartered|1link|iban/i.test(normalized)) {
    detectedProvider = 'bank_transfer';
  }

  // 2. Extract Transaction ID / Reference
  let extractedTransactionId: string | undefined;
  // Easypaisa / JazzCash / Bank TRX / TID patterns
  const txnPatterns = [
    /(?:TRX\s*ID|Transaction\s*ID|TID|Ref(?:erence)?\s*(?:No|Number|#)?|STAN)[:\s#]*([A-Za-z0-9-]{8,22})/i,
    /(?:Transaction\s*Reference)[:\s#]*([A-Za-z0-9-]{8,22})/i,
    /\b(0[0-9]{10,12})\b/, // 11-12 digit Easypaisa/Jazzcash numeric TID
  ];

  for (const regex of txnPatterns) {
    const match = normalized.match(regex);
    if (match && match[1]) {
      extractedTransactionId = match[1].trim();
      break;
    }
  }

  // 3. Extract Amount
  let extractedAmountPaisa: number | undefined;
  let extractedCurrency = 'PKR';
  // Patterns matching PKR 1,250.00, Rs. 1500.00, Rs. 500, Amount: 1500.00
  const amountPatterns = [
    /(?:Rs\.?|PKR)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i,
    /(?:Amount|Total\s*Paid|Transferred)[:\s]*(?:Rs\.?|PKR)?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i,
  ];

  for (const regex of amountPatterns) {
    const match = normalized.match(regex);
    if (match && match[1]) {
      try {
        const cleanAmount = match[1].replace(/,/g, '');
        const val = parseFloat(cleanAmount);
        if (!isNaN(val) && val > 0) {
          extractedAmountPaisa = rupeesToPaisa(val);
          break;
        }
      } catch (e) {
        notes.amountParseError = String(e);
      }
    }
  }

  // 4. Extract Receiver Account / Identifier
  let extractedReceiverAccount: string | undefined;
  const receiverAccountMatch = normalized.match(
    /(?:To|Receiver|Recipient|Account\s*Number|IBAN)[:\s]*([A-Za-z0-9\s-]{10,30})/i
  );
  if (receiverAccountMatch && receiverAccountMatch[1]) {
    extractedReceiverAccount = receiverAccountMatch[1].trim().replace(/\s+/g, '');
  }

  // 5. Extract Sender Account
  let extractedSenderAccount: string | undefined;
  const senderAccountMatch = normalized.match(
    /(?:From|Sender|Account)[:\s]*([0-9]{10,12})/i
  );
  if (senderAccountMatch && senderAccountMatch[1]) {
    extractedSenderAccount = senderAccountMatch[1].trim();
  }

  // 6. Extract Receiver Name
  let extractedReceiverName: string | undefined;
  const receiverNameMatch = normalized.match(
    /(?:Receiver\s*Name|Account\s*Title|To)[:\s]*([A-Za-z\s.]{3,35})(?:\n|$)/i
  );
  if (receiverNameMatch && receiverNameMatch[1]) {
    const nameCandidate = receiverNameMatch[1].trim();
    if (!/^[0-9]+$/.test(nameCandidate)) {
      extractedReceiverName = nameCandidate;
    }
  }

  // 7. Extract Date and Time
  let extractedDateTime: string | undefined;
  const dateMatch = normalized.match(
    /([0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}(?:\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:AM|PM)?)?)/i
  );
  if (dateMatch && dateMatch[1]) {
    extractedDateTime = dateMatch[1].trim();
  }

  const status = confidence < 35 && normalized.length < 20 ? 'low_confidence' : 'completed';

  return {
    rawText,
    confidenceScore: confidence,
    detectedProvider,
    extractedAmountPaisa,
    extractedCurrency,
    extractedTransactionId,
    extractedDateTime,
    extractedSenderAccount,
    extractedReceiverName,
    extractedReceiverAccount,
    status,
    extractionNotes: notes,
  };
}

/**
 * Execute Tesseract OCR on an image buffer
 */
export async function runOcrOnBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<OcrExtractionResult> {
  // If PDF, Tesseract directly cannot read raw PDF without rendering pages
  if (mimeType === 'application/pdf') {
    return {
      rawText: 'PDF document uploaded. OCR directly skipped; pending reviewer inspection.',
      confidenceScore: 100,
      status: 'completed',
      extractionNotes: {
        note: 'PDF file accepted for visual manual review inspection.',
      },
    };
  }

  try {
    const worker = await createWorker('eng');
    const ret = await worker.recognize(buffer);
    await worker.terminate();

    const confidence = ret.data.confidence;
    const text = ret.data.text;

    return parseReceiptText(text, confidence);
  } catch (err: any) {
    return {
      rawText: '',
      confidenceScore: 0,
      status: 'failed',
      extractionNotes: {
        error: err.message || 'OCR extraction failed',
      },
    };
  }
}
