from backend.taishan_pipeline.geometry import haversine_m, normalize_angle_delta, route_segment_distances


def test_haversine_equator_one_degree_is_about_111km():
    distance = haversine_m(0, 0, 1, 0)
    assert 111_000 <= distance <= 112_000


def test_route_segment_distances_keeps_point_order():
    distances = route_segment_distances([(0, 0), (1, 0), (1, 1)])
    assert len(distances) == 2
    assert 111_000 <= distances[0] <= 112_000
    assert 111_000 <= distances[1] <= 112_000


def test_normalize_angle_delta_wraps_heading_change():
    assert normalize_angle_delta(358) == -2
    assert normalize_angle_delta(-358) == 2
