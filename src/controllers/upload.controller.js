import { validateFile } from '../validators/file.validator.js';
import { uploadFileToCloudinary } from '../services/upload.service.js';

export async function uploadFile(req, res, next) {
  try {
    validateFile(req.file, req.body.carpeta);

    const { url, publicId } = await uploadFileToCloudinary(
      req.file.buffer,
      req.body.carpeta,
      req.file.mimetype
    );

    res.status(201).json({ url, publicId });
  } catch (error) {
    next(error);
  }
}
