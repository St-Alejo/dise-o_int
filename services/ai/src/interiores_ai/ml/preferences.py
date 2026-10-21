"""Modelo de preferencias de "Recomendar": aprende de los 👍/👎 de cada persona qué propuestas le gustan.

Cada propuesta llega con sus rasgos (estilo, temperatura y contraste de la paleta, piso, luz) y con
la nota "de oficio" que calcula la API. Con pocas opiniones (o todas iguales) manda esa nota; con
suficientes, una regresión logística sobre el historial estima la probabilidad de que guste y se
combina con ella. Se entrena en cada petición: son decenas de filas, cuesta milisegundos.
"""

from dataclasses import dataclass

from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression

# Lo que cuenta como "le gustó" (1) o "no le gustó" (0). 'shown' no dice nada.
LABELS: dict[str, int] = {"like": 1, "kept": 1, "dislike": 0, "undone": 0}
MIN_SAMPLES = 6
# Peso de lo aprendido frente a la nota de oficio (que ronda 0–1.6).
LEARNED_WEIGHT = 2.0


@dataclass
class Candidate:
    id: str
    features: dict[str, float]
    prior: float


@dataclass
class Sample:
    features: dict[str, float]
    action: str


@dataclass
class Ranking:
    scores: dict[str, float]
    model: str
    samples: int


def rank(candidates: list[Candidate], history: list[Sample]) -> Ranking:
    labelled = [(s.features, LABELS[s.action]) for s in history if s.action in LABELS]
    classes = {y for _, y in labelled}
    if len(labelled) < MIN_SAMPLES or len(classes) < 2:
        return Ranking(scores={c.id: c.prior for c in candidates}, model="prior", samples=len(labelled))
    vec = DictVectorizer(sparse=False)
    x = vec.fit_transform([f for f, _ in labelled])
    clf = LogisticRegression(C=1.0, max_iter=1000, class_weight="balanced")
    clf.fit(x, [y for _, y in labelled])
    probs = clf.predict_proba(vec.transform([c.features for c in candidates]))[:, 1]
    scores = {c.id: round(c.prior + LEARNED_WEIGHT * (float(p) - 0.5), 4) for c, p in zip(candidates, probs, strict=True)}
    return Ranking(scores=scores, model="logreg", samples=len(labelled))
