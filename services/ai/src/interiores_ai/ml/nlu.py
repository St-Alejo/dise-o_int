"""Modelo de intención del chat: TF-IDF (caracteres y palabras) + regresión logística.

Corre en CPU en milisegundos y no gasta IA externa. Los n-gramas de caracteres aguantan faltas de
ortografía ("baldoza", "parqet"); los de palabras, el orden ("quita la alfombra" frente a "sin
alfombras"). La confianza es la probabilidad de la intención ganadora: por debajo del umbral, la
API le pasa la frase a Groq.
"""

import contextlib
import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline

from . import dataset
from .lexicon import normalize
from .slots import Slots, extract

MODEL_VERSION = "nlu-1"


@dataclass
class Prediction:
    intent: str
    confidence: float
    alternatives: list[tuple[str, float]]
    slots: Slots


def build_pipeline() -> Pipeline:
    features = FeatureUnion(
        [
            ("chars", TfidfVectorizer(preprocessor=normalize, analyzer="char_wb", ngram_range=(2, 5), min_df=2, sublinear_tf=True)),
            ("words", TfidfVectorizer(preprocessor=normalize, ngram_range=(1, 2), min_df=1, sublinear_tf=True)),
        ]
    )
    return Pipeline([("features", features), ("clf", LogisticRegression(C=8.0, max_iter=3000))])


class IntentModel:
    """El clasificador entrenado y su versión (huella de los datos con que se entrenó)."""

    def __init__(self, pipeline: Pipeline, version: str) -> None:
        self.pipeline = pipeline
        self.version = version

    @classmethod
    def train(cls, rows: list[tuple[str, str]] | None = None) -> "IntentModel":
        rows = rows or dataset.generate()
        texts = [t for t, _ in rows]
        labels = [i for _, i in rows]
        pipeline = build_pipeline()
        pipeline.fit(texts, labels)
        digest = hashlib.sha256("\n".join(f"{t}\t{i}" for t, i in rows).encode()).hexdigest()[:10]
        return cls(pipeline, f"{MODEL_VERSION}-{digest}")

    def predict(self, text: str) -> Prediction:
        probs = cast(Any, self.pipeline.predict_proba([text]))[0]
        classes = [str(c) for c in self.pipeline.classes_]
        ranked = sorted(zip(classes, (float(p) for p in probs), strict=True), key=lambda kv: kv[1], reverse=True)
        intent, confidence = ranked[0]
        return Prediction(intent=intent, confidence=round(confidence, 4), alternatives=[(i, round(p, 4)) for i, p in ranked[1:4]], slots=extract(text))

    def predict_many(self, texts: list[str]) -> list[str]:
        return [str(p) for p in self.pipeline.predict(texts)]

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"pipeline": self.pipeline, "version": self.version}, path)

    @classmethod
    def load(cls, path: Path) -> "IntentModel":
        data = joblib.load(path)
        return cls(data["pipeline"], str(data["version"]))


class IntentService:
    """Carga perezosa: el modelo guardado en la imagen si existe; si no, se entrena una vez aquí."""

    def __init__(self, path: Path | None) -> None:
        self._path = path
        self._model: IntentModel | None = None
        self._lock = threading.Lock()

    @property
    def model(self) -> IntentModel:
        if self._model is None:
            with self._lock:
                if self._model is None:
                    self._model = self._load_or_train()
        return self._model

    def _load_or_train(self) -> IntentModel:
        if self._path and self._path.exists():
            try:
                return IntentModel.load(self._path)
            except Exception:  # un archivo de otra versión de sklearn: se vuelve a entrenar
                pass
        model = IntentModel.train()
        if self._path:
            # Sin permiso de escritura queda en memoria: se vuelve a entrenar en el próximo arranque.
            with contextlib.suppress(OSError):
                model.save(self._path)
        return model

    def parse(self, text: str) -> Prediction:
        return self.model.predict(text)
