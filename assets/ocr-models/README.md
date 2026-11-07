# On-device text recognition models (Card File)

PaddleOCR models in ONNX format, run in the browser by ONNX Runtime Web (`assets/vendor/ort/`).

| File | Model | Source |
|---|---|---|
| `det.onnx` | PP-OCRv4 text detection | `@gutenye/ocr-models` 1.4.2 (`ch_PP-OCRv4_det_infer.onnx`) |
| `cls.onnx` | Text direction (0°/180°) classifier | `@gutenye/ocr-models` 1.4.2 (`ch_ppocr_mobile_v2.0_cls_infer.onnx`) |
| `rec.onnx` | PP-OCRv3 English text recognition | `paddleocr-browser` 1.0.4 (`rec_en_PP-OCRv3_infer.onnx`) |
| `keys.txt` | Character list for `rec.onnx` (space is the class after the last line) | `paddleocr-browser` 1.0.4 (`dict_en.txt`) |

The models come from [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) (Apache-2.0); the npm packages
that repackage them are MIT. The English recognizer was chosen over PP-OCRv4's Chinese/English one because it
keeps the spaces between words. Refresh with `cd tools && npm install && npm run copy-ocr`.
