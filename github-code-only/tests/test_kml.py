from pathlib import Path

from backend.taishan_pipeline.kml import parse_kml


def test_parse_kml_reads_waypoints_and_mis_fields():
    kml_file = Path("raw") / "35kV(东平)35kV驻张线(东平)35kV驻张线#12.kml"
    parsed = parse_kml(kml_file)

    assert parsed.route["waypoint_count"] == 25
    assert parsed.route["min_height"] is not None
    assert parsed.route["max_height"] is not None
    assert parsed.route["total_length"] > 0
    assert parsed.waypoints[0]["speed"] is not None
    assert parsed.waypoints[0]["heading"] is not None
    assert "推断" in parsed.route["route_type_guess"]
