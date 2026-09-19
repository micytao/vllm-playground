"""API tests for /api/recipes/* (vLLM community recipes catalog)."""


def test_get_recipes_returns_full_catalog(client):
    resp = client.get("/api/recipes")
    assert resp.status_code == 200
    body = resp.json()
    assert "categories" in body
    assert len(body["categories"]) > 0
    assert "id" in body["categories"][0]


def test_get_recipes_by_known_category(client):
    all_recipes = client.get("/api/recipes").json()
    category_id = all_recipes["categories"][0]["id"]

    resp = client.get(f"/api/recipes/{category_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == category_id


def test_get_recipes_by_unknown_category_returns_404(client):
    resp = client.get("/api/recipes/not-a-real-category")
    assert resp.status_code == 404


def test_get_specific_recipe_config(client):
    all_recipes = client.get("/api/recipes").json()
    category = all_recipes["categories"][0]
    recipe = category["recipes"][0]

    resp = client.get(f"/api/recipes/{category['id']}/{recipe['id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["recipe"]["id"] == recipe["id"]
    assert body["category"]["id"] == category["id"]


def test_get_recipe_unknown_id_returns_404(client):
    all_recipes = client.get("/api/recipes").json()
    category_id = all_recipes["categories"][0]["id"]

    resp = client.get(f"/api/recipes/{category_id}/not-a-real-recipe")
    assert resp.status_code == 404
