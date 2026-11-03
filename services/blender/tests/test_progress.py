from interiores_blender.progress import MEASURE_END, MEASURE_START, ProgressReader


def test_las_muestras_del_pre_render_que_mide_la_luz_no_cuentan_como_avance() -> None:
    reader = ProgressReader()
    assert reader.feed("Updating Scene BVH") == 5
    assert reader.feed(f"{MEASURE_START} (128x72)") is None
    assert reader.feed("Fra:1 | Sample 16/16") is None
    assert reader.feed(f"{MEASURE_END}: media 0.21, exposición 0.80") is None
    assert reader.feed("Fra:1 | Sample 64/128") is not None
