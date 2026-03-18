'use strict';

const winston   = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path      = require('path');
const fs        = require('fs');

const logDir = process.env.LOG_DIR || './logs';
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const fileTransport = new DailyRotateFile({
  filename:     path.join(logDir, 'vanguard-%DATE%.log'),
  datePattern:  'YYYY-MM-DD',
  zippedArchive: true,
  maxSize:      '50m',
  maxFiles:     '30d',
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(timestamp(), errors({ stack: true }), json()),
  transports: [
    fileTransport,
    new winston.transports.Console({
      format: combine(colorize(), simple()),
      silent: process.env.NODE_ENV === 'test',
    }),
  ],
});

module.exports = logger;
