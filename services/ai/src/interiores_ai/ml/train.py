"""Entrena el modelo de intención y lo guarda: `python -m interiores_ai.ml.train --out models`.

Imprime la F1 macro sobre un conjunto de validación generado con otra semilla (frases que el modelo
no vio). La imagen de producción lo ejecuta al construirse, así el servicio arranca con el modelo.
"""

import argparse
from pathlib import Path

from sklearn.metrics import f1_score

from . import dataset
from .nlu import IntentModel


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="models", help="carpeta de salida")
    parser.add_argument("--per-intent", type=int, default=900)
    args = parser.parse_args()
    model = IntentModel.train(dataset.generate(args.per_intent, seed=7))
    val = dataset.generate(150, seed=99)
    f1 = f1_score([i for _, i in val], model.predict_many([t for t, _ in val]), average="macro")
    path = Path(args.out) / "nlu.joblib"
    model.save(path)
    print(f"{model.version}: F1 macro (validación) = {f1:.3f} → {path}")


if __name__ == "__main__":
    main()
