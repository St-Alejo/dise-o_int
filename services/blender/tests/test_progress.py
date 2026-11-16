from interiores_blender.progress import MEASURE_END, MEASURE_START, ProgressReader


def test_light_metering_prerender_samples_do_not_count_as_progress() -> None:
    reader = ProgressReader()
    assert reader.feed("Updating Scene BVH") == 5
    assert reader.feed(f"{MEASURE_START} (128x72)") is None
    assert reader.feed("Fra:1 | Sample 16/16") is None
    assert reader.feed(f"{MEASURE_END}: media 0.21, exposición 0.80") is None
    assert reader.feed("Fra:1 | Sample 64/128") is not None
