import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type NextFunction, type Request, type Response, type Router } from 'express';
import { MemoryDataAdapter, type AssistantAdapters } from '@ai-assistant/core';
import { createAssistantServerRouter } from '@ai-assistant/server';
import { libraryAssistantConfig } from '../../assistant.config.ts';


export interface BookRecord {
  id: string;
  title: string;
  author: string;
  isbn: string;
  shelf: string;
  copies: number;
  available: number;
}

export interface LoanRecord {
  id: string;
  bookId: string;
  bookTitle: string;
  memberName: string;
  dueDate: string;
  returned: boolean;
}

export const DEMO_LIBRARY_TOKEN = 'demo-library-token';

export function createLibraryStore() {
  const books: BookRecord[] = [
    {
      id: 'bk-1',
      title: 'Designing Data-Intensive Applications',
      author: 'Martin Kleppmann',
      isbn: '978-1449373320',
      shelf: 'CS-04',
      copies: 5,
      available: 3,
    },
    {
      id: 'bk-2',
      title: 'Principles of Corporate Finance',
      author: 'Richard Brealey',
      isbn: '978-1260565553',
      shelf: 'EC-12',
      copies: 4,
      available: 4,
    },
    {
      id: 'bk-3',
      title: 'Clean Architecture',
      author: 'Robert C. Martin',
      isbn: '978-0134494166',
      shelf: 'CS-02',
      copies: 3,
      available: 2,
    },
  ];

  const loans: LoanRecord[] = [
    {
      id: 'ln-1',
      bookId: 'bk-1',
      bookTitle: 'Designing Data-Intensive Applications',
      memberName: 'Aarav Krishnan',
      dueDate: '2026-11-24',
      returned: false,
    },
  ];

  return { books, loans };
}

export function createLibraryRouter(store = createLibraryStore()): Router {
  const router = express.Router();

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      res.status(401).json({ error: 'Missing Authorization Bearer token.' });
      return;
    }
    next();
  };

  router.get('/me', requireAuth, (_req, res) => {
    res.json({
      userId: 'librarian-01',
      name: 'Rohan Menon',
      role: 'librarian',
      appId: 'second-demo',
    });
  });

  router.get('/books', requireAuth, (req, res) => {
    const q = typeof req.query.query === 'string' ? req.query.query.toLowerCase().trim() : '';
    const books = store.books.filter(
      (b) =>
        !q ||
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        b.shelf.toLowerCase().includes(q)
    );
    res.json({ books });
  });

  router.post('/books', requireAuth, (req, res) => {
    const body = req.body as Partial<BookRecord>;
    if (!body.title || !body.author || !body.isbn) {
      res.status(400).json({ error: 'title, author, and isbn are required.' });
      return;
    }
    const copies = Math.max(1, Number(body.copies ?? 1));
    const record: BookRecord = {
      id: `bk-${crypto.randomUUID().slice(0, 8)}`,
      title: body.title.trim(),
      author: body.author.trim(),
      isbn: body.isbn.trim(),
      shelf: (body.shelf || 'GEN-01').trim(),
      copies,
      available: copies,
    };
    store.books.unshift(record);
    res.status(201).json({ id: record.id, record });
  });

  router.post('/books/undo', requireAuth, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids.map(String)) : new Set<string>();
    let removed = 0;
    for (let i = store.books.length - 1; i >= 0; i -= 1) {
      if (ids.has(store.books[i].id)) {
        store.books.splice(i, 1);
        removed += 1;
      }
    }
    res.json({ undoneCount: removed });
  });

  router.get('/loans', requireAuth, (_req, res) => {
    res.json({ loans: store.loans });
  });

  router.post('/loans', requireAuth, (req, res) => {
    const { bookId, memberName } = req.body as { bookId?: string; memberName?: string };
    const book = store.books.find((b) => b.id === bookId);
    if (!book) {
      res.status(404).json({ error: 'Book not found.' });
      return;
    }
    if (book.available <= 0) {
      res.status(409).json({ error: 'No available copies left for checkout.' });
      return;
    }
    book.available -= 1;
    const due = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const loan: LoanRecord = {
      id: `ln-${crypto.randomUUID().slice(0, 8)}`,
      bookId: book.id,
      bookTitle: book.title,
      memberName: (memberName || 'Campus Member').trim(),
      dueDate: due,
      returned: false,
    };
    store.loans.unshift(loan);
    res.status(201).json({ id: loan.id, record: loan });
  });

  router.post('/loans/undo', requireAuth, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids.map(String)) : new Set<string>();
    let removed = 0;
    for (let i = store.loans.length - 1; i >= 0; i -= 1) {
      const loan = store.loans[i];
      if (ids.has(loan.id)) {
        const book = store.books.find((b) => b.id === loan.bookId);
        if (book && !loan.returned) book.available += 1;
        store.loans.splice(i, 1);
        removed += 1;
      }
    }
    res.json({ undoneCount: removed });
  });

  router.post('/loans/:id/return', requireAuth, (req, res) => {
    const loan = store.loans.find((l) => l.id === req.params.id);
    if (!loan) {
      res.status(404).json({ error: 'Loan not found.' });
      return;
    }
    if (!loan.returned) {
      loan.returned = true;
      const book = store.books.find((b) => b.id === loan.bookId);
      if (book) book.available = Math.min(book.copies, book.available + 1);
    }
    res.json({ loan });
  });

  router.post('/loans/:id/unreturn', requireAuth, (req, res) => {
    const loan = store.loans.find((l) => l.id === req.params.id);
    if (!loan) {
      res.status(404).json({ error: 'Loan not found.' });
      return;
    }
    if (loan.returned) {
      loan.returned = false;
      const book = store.books.find((b) => b.id === loan.bookId);
      if (book) book.available = Math.max(0, book.available - 1);
    }
    res.json({ loan });
  });

  return router;
}

export function createLibraryApp(store = createLibraryStore()): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));

  const router = createLibraryRouter(store);
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'second-demo-app' });
  });

  // Mount Universal Assistant SDK drop-in routes
  const adapters: AssistantAdapters = {
    data: new MemoryDataAdapter({
      books: store.books as any,
      loans: store.loans as any,
    }),
  };
  const assistantRouter = createAssistantServerRouter({
    config: libraryAssistantConfig,
    adapters,
  });
  app.use('/assistant', assistantRouter);
  app.use('/api/assistant', assistantRouter);

  app.use('/api/demo/second-demo', router);
  app.use('/', router);


  return app;
}

const app = createLibraryApp();
export default app;

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const currentPath = fileURLToPath(import.meta.url);
if (!process.env.VERCEL && entryPath === currentPath) {
  const port = Number(process.env.PORT || 3002);
  app.listen(port, '0.0.0.0', () => {
    console.log(`second-demo-app listening on port ${port}`);
  });
}

